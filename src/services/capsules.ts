import { getOpenAIClient } from './openai-client';
import { NormalizedUserProfile, CapsulePair } from '../utils/types';
import { joinWithLineBreak } from '../utils/sanitize';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { getEnv } from '../utils/env';
import { logger } from '../utils/logger';
import { extractLabelingEvidence, LabelingEvidenceResult } from '../utils/evidence';
import { validateTaskCapsule } from './validate';

const CAPSULE_TEMPERATURE = 0.2;
const DEFAULT_CAPSULE_MODEL = 'gpt-4o-mini';
export const CAPSULE_SYSTEM_MESSAGE =
  'You generate two capsules for vector search on a talent marketplace across ANY domain (e.g., medicine, software engineering, writing, finance, legal, design, manufacturing, logistics, education, etc.). Be PII-safe: do not include personal names or contact details. Refer to the person as “the candidate.”';
let capsuleModelWarningLogged = false;

function resolveCapsuleModel(): string {
  const override = getEnv('OPENAI_CAPSULE_MODEL');
  if (override) {
    return override;
  }

  if (!capsuleModelWarningLogged) {
    logger.warn(
      {
        defaultModel: DEFAULT_CAPSULE_MODEL,
      },
      'OPENAI_CAPSULE_MODEL is not set; falling back to default model'
    );
    capsuleModelWarningLogged = true;
  }

  return DEFAULT_CAPSULE_MODEL;
}


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

STRICT RULES
- Use ONLY facts that appear in SOURCE.
- Do NOT invent credentials, employers, dates, tools, tasks, or platforms.
- PII: Do NOT include names or direct identifiers; refer to “the candidate.”
- Domain Capsule MUST NOT include AI/LLM labeling/evaluation/training terms or tools.
- Task Capsule MUST obey EVIDENCE rules below.

CAPSULES

1) Profile Domain Capsule (120–200 words)
   - Subject-matter expertise ONLY (ANY domain: clinical specialties, programming languages & frameworks, finance topics, legal practice areas, writing/editing domains, etc.), but only if present in SOURCE.
   - Prefer concrete nouns (subdomains, procedures, frameworks, standards, data types, environments).
   - Do NOT include AI/LLM annotation, labeling, evaluation, RLHF, tools, or QA terms here.
   - End with: Keywords: <10–20 tokens that appear in this paragraph AND in SOURCE>

2) Profile Task Capsule (AI/LLM data work ONLY; see EVIDENCE)
   - If EVIDENCE list is NON-EMPTY:
       * Write 120–200 words describing ONLY AI/LLM data-labeling/training/evaluation activities that explicitly appear in EVIDENCE/SOURCE (tasks, label types, modalities, tools/platforms, QA, RLHF/DPO/SFT).
       * DO NOT include generic data duties (e.g., “data entry,” “documentation,” “EHR/workflow,” “research studies,” “Excel analysis,” “cohort analysis,” “analytics,” “QA” not specific to labeling). Exclude these unless they are explicitly described as AI/LLM labeling/evaluation/training in SOURCE.
       * Domain nouns may be mentioned only if they co-occur with labeling terms in SOURCE (e.g., “medical NER,” “code annotation”). Otherwise omit domain nouns.
       * End with: Keywords: <10–20 tokens that appear in this paragraph AND in EVIDENCE/SOURCE>
   - If EVIDENCE list is EMPTY:
       * Output EXACTLY this one-sentence paragraph:
         "No AI/LLM data-labeling, model training, or evaluation experience was provided in the source."
       * Then on the next line output EXACTLY:
         "Keywords: none"

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
${languages}
${country}

EVIDENCE (use ONLY these tokens/phrases for the Task Capsule when non-empty; if empty, follow the empty rule):
${evidenceList}

OUTPUT FORMAT:
<Profile Domain Capsule paragraph>
Keywords: ...

<Profile Task Capsule paragraph OR the exact 'no experience' sentence>
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
    domain: { text: capsules.domain.text },
    task: { text: validation.text },
  };
}

