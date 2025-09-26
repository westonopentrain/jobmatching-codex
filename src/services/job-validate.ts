import { AppError } from '../utils/errors';
import { NormalizedJobPosting } from '../utils/types';

const KEYWORD_MIN = 10;
const KEYWORD_MAX = 20;

const DOMAIN_AI_TERMS = [
  'annotation',
  'annotating',
  'label',
  'labeling',
  'labelling',
  'labels',
  'llm',
  'ai',
  'artificial intelligence',
  'machine learning',
  'model training',
  'modeling',
  'prompt',
  'rlhf',
  'sft',
  'dpo',
  'reward modeling',
  'fine-tuning',
  'finetuning',
  'fine tuning',
  'ner',
  'ocr',
  'bbox',
  'bounding box',
  'segmentation',
  'dataset labeling',
  'quality assurance',
  'qa',
  'evaluation',
  'training data',
  'synthetic data',
  'dataset curation',
  'prompt engineering',
  'chatbot',
];

const TASK_NON_AI_PHRASES = [
  'patient care',
  'direct patient',
  'clinical visits',
  'clinic visits',
  'clinic operations',
  'surgical procedures',
  'perform surgeries',
  'medical treatment',
  'treatment planning',
  'treatment plans',
  'deliver babies',
  'labor and delivery',
  'prenatal care',
  'postnatal care',
  'appointment scheduling',
  'office administration',
  'administrative duties',
  'office management',
  'patient scheduling',
  'customer service',
  'sales outreach',
  'sales calls',
  'business development',
  'marketing campaigns',
  'project management',
  'team management',
  'staff supervision',
  'human resources',
  'hr management',
  'people management',
  'inventory management',
  'supply management',
  'medical billing',
  'insurance claims',
  'financial analysis',
  'market research',
  'general research',
  'clinical research duties',
  'patient education',
  'therapy sessions',
  'case management',
  'content writing',
  'copywriting',
];

interface ParsedCapsule {
  body: string;
  keywordsLine: string;
  keywords: string[];
}

function splitCapsule(capsule: string): ParsedCapsule {
  const trimmed = capsule.trim();
  const match = trimmed.match(/([\s\S]*?)\nKeywords:\s*(.+)$/i);
  if (!match) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Capsule is missing a Keywords line',
      details: { capsule: trimmed.slice(0, 200) },
    });
  }

  const body = match[1]?.trim() ?? '';
  const keywordsLine = match[2]?.trim() ?? '';
  if (!body) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Capsule text is empty',
      details: { capsule: trimmed.slice(0, 200) },
    });
  }
  if (!keywordsLine) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Capsule is missing keywords tokens',
      details: { capsule: trimmed.slice(0, 200) },
    });
  }

  let keywords = keywordsLine
    .split(/[;,]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (keywords.length === 0) {
    keywords = keywordsLine
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  if (keywords.length < KEYWORD_MIN || keywords.length > KEYWORD_MAX) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: `Capsule Keywords line must contain between ${KEYWORD_MIN} and ${KEYWORD_MAX} tokens`,
      details: { keywordsLine },
    });
  }

  return { body, keywordsLine, keywords };
}

function ensureKeywordsAppear(keywords: string[], capsuleText: string, jobSource: string): void {
  const capsuleLower = capsuleText.toLowerCase();
  const jobLower = jobSource.toLowerCase();

  const missing: string[] = [];
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase();
    if (!capsuleLower.includes(normalized) || !jobLower.includes(normalized)) {
      missing.push(keyword);
    }
  }

  if (missing.length > 0) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Capsule keywords must appear in both capsule text and job fields',
      details: { missing },
    });
  }
}

export interface JobDomainValidationResult {
  text: string;
  needsDomainReprompt: boolean;
}

export interface JobTaskValidationResult {
  text: string;
  needsTaskReprompt: boolean;
}

export function validateJobDomainCapsule(
  capsule: string,
  job: NormalizedJobPosting
): JobDomainValidationResult {
  const parsed = splitCapsule(capsule);
  ensureKeywordsAppear(parsed.keywords, parsed.body, job.sourceText);

  const lower = parsed.body.toLowerCase();
  const includesBlocked = DOMAIN_AI_TERMS.some((term) => lower.includes(term));

  return {
    text: capsule.trim(),
    needsDomainReprompt: includesBlocked,
  };
}

export function validateJobTaskCapsule(
  capsule: string,
  job: NormalizedJobPosting
): JobTaskValidationResult {
  const parsed = splitCapsule(capsule);
  ensureKeywordsAppear(parsed.keywords, parsed.body, job.sourceText);

  const lower = parsed.body.toLowerCase();
  const includesBlocked = TASK_NON_AI_PHRASES.some((phrase) => lower.includes(phrase));

  return {
    text: capsule.trim(),
    needsTaskReprompt: includesBlocked,
  };
}
