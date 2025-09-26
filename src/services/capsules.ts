import { getOpenAIClient } from './openai-client';
import { NormalizedUserProfile, CapsulePair } from '../utils/types';
import { joinLanguages, joinWithLineBreak } from '../utils/sanitize';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';

const CAPSULE_MODEL = process.env.OPENAI_CAPSULE_MODEL ?? 'gpt-4o-mini';
const CAPSULE_TEMPERATURE = 0.2;

export function buildCapsulePrompt(profile: NormalizedUserProfile): string {
  const workExperience = joinWithLineBreak(profile.workExperience);
  const education = joinWithLineBreak(profile.education);
  const labelingExperience = joinWithLineBreak(profile.labelingExperience);
  const languages = joinLanguages(profile.languages);
  const country = profile.country ?? 'Unknown';

  return `Write TWO capsules for vector search used on a data-labeling / AI training marketplace.

1) Profile Domain Capsule (120–200 words): subject-matter specialties ONLY (e.g., OB-GYN, civil engineering, HTML/CSS/JS). Domain nouns must be present verbatim in the Source (or a direct standard synonym of an exact Source term). If uncertain, omit the term.
2) Profile Task Capsule (120–200 words): data-labeling/AI experience (tasks, label types, modalities, platforms, QA). Avoid adding specialties not present.

Each capsule ends with:
"Keywords:" then 10–20 comma-separated tokens that ALREADY appear in that capsule AND in the Source.

Use ONLY the facts in Source. No personal identifiers. Temperature 0.2.

SOURCE (verbatim):
- Resume Text: ${profile.resumeText}
- Work Experience: ${workExperience}
- Education: ${education}
- Labeling Experience: ${labelingExperience}
- Languages/Country: ${languages}, ${country}

OUTPUT:
<Profile Domain Capsule paragraph>
Keywords: ...

<Profile Task Capsule paragraph>
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
  const prompt = buildCapsulePrompt(profile);
  const client = getOpenAIClient();

  const completion = await withRetry(() =>
    client.chat.completions.create({
      model: CAPSULE_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that writes precise professional summaries.',
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

  return extractCapsuleTexts(content);
}

export const capsuleModel = CAPSULE_MODEL;
