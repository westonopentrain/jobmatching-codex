import { NormalizedUserProfile, CapsulePair } from '../utils/types';
import { joinWithLineBreak } from '../utils/sanitize';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { extractLabelingEvidence, LabelingEvidenceResult } from '../utils/evidence';
import { validateDomainCapsule, validateTaskCapsule } from './validate';
import { resolveCapsuleModel } from './openai-model';
import { createTextResponse } from './openai-responses';

const CAPSULE_TEMPERATURE = 0.2;
export const CAPSULE_SYSTEM_MESSAGE =
  'You create profile summaries for freelancer matching using vector similarity. The capsules you output will be embedded and compared against JOB POSTING embeddings. Your job: Output text that would be SEMANTICALLY SIMILAR to job postings seeking this candidate. Be PII-safe: do not include names or contact details.';

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

  return `Write TWO capsules that will be embedded and matched against JOB POSTING embeddings.

CRITICAL CONTEXT: This is for a freelancer marketplace where users are matched to AI data labeling jobs.
Your output must be SEMANTICALLY SIMILAR to what job postings say when seeking this type of candidate.

## DOMAIN CAPSULE (WHO is this person? 5-20 words)

Ask yourself these questions IN ORDER. Stop at the FIRST YES:

1. Does this person have a SPECIFIC PROFESSION (doctor, lawyer, engineer, accountant, nurse)?
   → Output: "[Profession title]. [Specialty/domain]."
   → Example: "OBGYN physician. Obstetrics and gynecology medical expertise."

2. Does this person have SPECIFIC LANGUAGE expertise (native speaker, translator, linguist)?
   → Output: "[Language] native speaker. [Relevant skills]."
   → Example: "Swedish native speaker. Translation and localization expertise."

3. Does this person have SPECIFIC TECHNICAL SKILLS (programming, design, data analysis)?
   → Output: "[Role]. [Technologies/skills]."
   → Example: "Angular developer. JavaScript, TypeScript, frontend engineering."

4. If NO to all above:
   → Output: "General workforce. No specialized expertise documented."

RULES:
- Use ONLY facts explicitly stated in SOURCE. Do NOT infer or embellish.
- Do NOT include: AI/LLM terms, dates, employers, years of experience, soft skills.
- Output MUST be 5-20 words total (not counting keywords).
- End with: Keywords: <3-8 key domain nouns>

## TASK CAPSULE (WHAT AI/data work experience? 10-25 words)

If EVIDENCE is NON-EMPTY, answer:
1. MODALITY? (text, image, audio, video, code)
2. WORK TYPE? (annotation, evaluation, review, QA, transcription)
3. TECHNIQUE? (bounding box, segmentation, NER, ranking, rating)
4. AI WORKFLOW? (SFT, RLHF, DPO, red-teaming)

→ Output format: "[Modality] [work type]. [Technique/workflow details]."
→ Example: "LLM response evaluation. RLHF preference ranking, SFT data creation."
→ End with: Keywords: <5-10 task-related nouns from EVIDENCE>

If EVIDENCE is EMPTY:
→ Output EXACTLY: "No AI/LLM data-labeling, model training, or evaluation experience documented."
→ Keywords: none

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

EVIDENCE (for Task Capsule only; if empty, use the fixed 'no experience' line):
${evidenceList}

OUTPUT FORMAT:
<Domain Capsule text here>
Keywords: ...

<Task Capsule text here OR the fixed 'no experience' line>
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
  const capsuleModel = resolveCapsuleModel();

  const responseText = await withRetry(() =>
    createTextResponse({
      model: capsuleModel,
      messages: [
        { role: 'system', content: CAPSULE_SYSTEM_MESSAGE },
        { role: 'user', content: prompt },
      ],
      temperature: CAPSULE_TEMPERATURE,
      frequencyPenalty: 0.6,
      presencePenalty: 0,
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

  if (!responseText) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Received empty response from language model',
    });
  }

  const capsules = extractCapsuleTexts(responseText);

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
