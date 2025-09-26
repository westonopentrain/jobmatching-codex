import { getOpenAIClient } from './openai-client';
import { NormalizedUserProfile, CapsulePair } from '../utils/types';
import { joinWithLineBreak } from '../utils/sanitize';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { extractLabelingEvidence, LabelingEvidenceResult } from '../utils/evidence';
import { validateDomainCapsule, validateTaskCapsule } from './validate';
import { resolveCapsuleModel } from './openai-model';

const CAPSULE_TEMPERATURE = 0.2;
export const CAPSULE_SYSTEM_MESSAGE =
  'You generate two capsules for vector search on a talent marketplace. Capsules must be domain-agnostic (work for medicine, software, writing, finance, legal, etc.). Be PII-safe: do not include names or contact details. Refer to the person as "the candidate."';

function buildEvidenceSource(profile: NormalizedUserProfile): string {
  const segments: string[] = [profile.resumeText];
  segments.push(...profile.workExperience);
  segments.push(...profile.education);
  segments.push(...profile.labelingExperience);
  segments.push(...profile.languages);
  if (profile.country) {
    segments.push(profile.country);
  }

  return segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('\n');
}

function formatEvidenceList(evidence: LabelingEvidenceResult): {
  list: string;
  ordered: string[];
} {
  const combined = [...evidence.phrases, ...evidence.tokens];
  const unique = Array.from(new Set(combined));
  unique.sort((a, b) => a.localeCompare(b));

  if (unique.length === 0) {
    return { list: '(none)', ordered: [] };
  }

  const formatted = unique.map((term) => `- ${term}`).join('\n');
  return { list: formatted, ordered: unique };
}

export function buildCapsulePrompt(
  profile: NormalizedUserProfile,
  evidence: LabelingEvidenceResult
): string {
  const workExperience = joinWithLineBreak(profile.workExperience);
  const education = joinWithLineBreak(profile.education);
  const labelingExperience = joinWithLineBreak(profile.labelingExperience);
  const languages = joinWithLineBreak(profile.languages);
  const country = profile.country ?? 'Unknown';
  const { list: evidenceList } = formatEvidenceList(evidence);

  return `Write TWO capsules.

GLOBAL RULES
- Use ONLY facts in SOURCE. Do NOT invent anything.
- PII: Do NOT include names; use "the candidate."
- Keep prose minimal and noun-dense. Avoid role narratives, responsibilities, methods, dates, employers, or soft skills.

1) Profile Domain Capsule (strictly subject-matter; 40-120 words)
   - Include ONLY domain/subject-matter nouns present in SOURCE (or standard synonyms of exact SOURCE terms).
   - Examples of acceptable content: languages (including dialects), scientific fields, engineering disciplines, programming languages/frameworks, finance/legal domains, industry verticals, certifications/credentials, specialized procedures, standards, data types.
   - EXCLUDE: roles/titles (e.g., instructor, manager, writer), verbs (taught, organized, led), responsibilities, pedagogy, employment history, years, company names, soft skills, tooling, AI/LLM terms.
   - Style: compressed, telegraphic; one or two concise sentences or a single condensed line of noun phrases.
   - End with: Keywords: <10-20 tokens that appear in this capsule AND in SOURCE>

2) Profile Task Capsule (AI/LLM data work ONLY; evidence-only; 0 or 120-200 words)
   - If EVIDENCE is NON-EMPTY:
       * Describe ONLY AI/LLM data labeling/training/evaluation activities present in EVIDENCE/SOURCE (tasks, label types, modalities, tools/platforms, QA, SFT/DPO/RLHF).
       * Domain nouns may be mentioned only when they co-occur with labeling terms in SOURCE (e.g., "medical NER", "code annotation"). Otherwise omit domain nouns.
       * EXCLUDE generic duties (data entry, documentation, EHR, research study, Excel analysis, admin, analytics) unless explicitly tied to AI/LLM labeling/evaluation/training in SOURCE.
       * End with: Keywords: <10-20 tokens that appear in this capsule AND in EVIDENCE/SOURCE>
   - If EVIDENCE is EMPTY:
       * Output EXACTLY:
         No AI/LLM data-labeling, model training, or evaluation experience was provided in the source.
         Keywords: none

SOURCE (verbatim):
- Resume Text:
${profile.resumeText}
- Work Experience:
${workExperience}
- Education:
${education}
- Labeling/AI Experience:
${labelingExperience}
- Languages/Country:
${languages}, ${country}

EVIDENCE (use ONLY these for the Task Capsule when non-empty; if empty, use the fixed line above):
${evidenceList}

OUTPUT FORMAT:
<Profile Domain Capsule>
Keywords: ...

<Profile Task Capsule OR the fixed 'no experience' line>
Keywords: ...`;
}

export function extractCapsuleTexts(raw: string): CapsulePair {
  const trimmed = raw.trim();
  const capsuleRegex = /([\s\S]+?Keywords:[^\n]*)(?:\n{2,}|$)/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = capsuleRegex.exec(trimmed)) !== null) {
    const segment = match[1];
    if (segment) {
      matches.push(segment.trim());
    }
    if (matches.length === 2) {
      break;
    }
  }

  if (matches.length !== 2) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Unable to parse capsule response from language model',
      details: { snippet: trimmed.slice(0, 200) },
    });
  }

  for (const capsule of matches) {
    if (!/Keywords:\s*.+/i.test(capsule)) {
      throw new AppError({
        code: 'LLM_FAILURE',
        statusCode: 502,
        message: 'Capsule is missing a Keywords line',
        details: { capsule },
      });
    }
  }

  const [domain, task] = matches as [string, string];

  return {
    domain: { text: domain },
    task: { text: task },
  };
}

export async function generateCapsules(profile: NormalizedUserProfile): Promise<CapsulePair> {
  const evidenceSource = buildEvidenceSource(profile);
  const evidence = extractLabelingEvidence(evidenceSource);
  const prompt = buildCapsulePrompt(profile, evidence);
  const evidenceSet = new Set([...evidence.tokens, ...evidence.phrases]);
  const client = getOpenAIClient();

  const capsuleModel = resolveCapsuleModel();

  const completion = await withRetry(() =>
    client.chat.completions.create({
      model: capsuleModel,
      messages: [
        {
          role: 'system',
          content: CAPSULE_SYSTEM_MESSAGE,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: CAPSULE_TEMPERATURE,
    })
  ).catch((error) => {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Failed to generate capsules with OpenAI',
      details: { message: (error as Error).message },
    });
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Received empty response from language model',
    });
  }

  const capsules = extractCapsuleTexts(content);

  const domainValidation = await validateDomainCapsule(capsules.domain.text);
  const validation = validateTaskCapsule(capsules.task.text, evidenceSet);
  if (validation.violations.length > 0) {
    logger.warn(
      {
        event: 'capsules.validation',
        userId: profile.userId,
        violations: validation.violations,
      },
      'Task capsule replaced with fixed sentence due to validation violations'
    );
  }

  return {
    domain: { text: domainValidation.revised },
    task: { text: validation.text },
  };
}
