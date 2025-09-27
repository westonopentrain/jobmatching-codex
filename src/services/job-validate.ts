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

function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const normalized = normalizeForSearch(text);
  if (!normalized) return [];
  return normalized.split(' ');
}

function buildTokenVariants(token: string): string[] {
  const variants = new Set<string>([token]);

  if (token.endsWith('ies') && token.length > 3) {
    variants.add(`${token.slice(0, -3)}y`);
  }

  if (token.endsWith('es') && token.length > 2) {
    variants.add(token.slice(0, -2));
  }

  if (token.endsWith('s') && token.length > 1) {
    variants.add(token.slice(0, -1));
  }

  if (token.endsWith('ing') && token.length > 4) {
    variants.add(token.slice(0, -3));
    variants.add(`${token.slice(0, -3)}e`);
  }

  if (token.endsWith('ed') && token.length > 3) {
    variants.add(token.slice(0, -2));
    variants.add(token.slice(0, -1));
  }

  if (token.endsWith('er') && token.length > 3) {
    variants.add(token.slice(0, -2));
  }

  if (token.endsWith('ency') && token.length > 4) {
    variants.add(`${token.slice(0, -3)}t`);
  }

  if (token.endsWith('ancy') && token.length > 4) {
    variants.add(`${token.slice(0, -3)}t`);
  }

  return Array.from(variants);
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i]![0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost
      );
    }
  }

  return matrix[a.length]![b.length]!;
}

function tokenMatches(token: string, haystackSet: Set<string>, haystackTokens: string[]): boolean {
  if (haystackSet.has(token)) {
    return true;
  }

  for (const variant of buildTokenVariants(token)) {
    if (haystackSet.has(variant)) {
      return true;
    }
  }

  if (token.length >= 4) {
    for (const candidate of haystackTokens) {
      if (Math.abs(candidate.length - token.length) > 2) continue;
      if (levenshteinDistance(token, candidate) <= 1) {
        return true;
      }
    }
  }

  return false;
}

function countTokenMatches(tokens: string[], haystackSet: Set<string>, haystackTokens: string[]): number {
  let matches = 0;
  for (const token of tokens) {
    if (tokenMatches(token, haystackSet, haystackTokens)) {
      matches += 1;
    }
  }
  return matches;
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

function ensureKeywordsAppear(
  context: 'domain' | 'task',
  keywords: string[],
  capsuleText: string,
  jobSource: string
): void {
  const capsuleTokens = tokenize(capsuleText);
  const jobTokens = tokenize(jobSource);

  const capsuleTokenSet = new Set(capsuleTokens);
  const jobTokenSet = new Set(jobTokens);

  const missing: string[] = [];

  for (const keyword of keywords) {
    const keywordTokens = tokenize(keyword);
    if (keywordTokens.length === 0) {
      continue;
    }

    const requiredMatches = keywordTokens.length === 1 ? 1 : Math.max(1, Math.ceil(keywordTokens.length / 2));

    const capsuleMatches = countTokenMatches(keywordTokens, capsuleTokenSet, capsuleTokens);
    const jobMatches = countTokenMatches(keywordTokens, jobTokenSet, jobTokens);

    if (capsuleMatches < requiredMatches || jobMatches < requiredMatches) {
      missing.push(keyword);
    }
  }

  if (missing.length > 0) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Capsule keywords must appear in both capsule text and job fields',
      details: { missing, context },
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
  ensureKeywordsAppear('domain', parsed.keywords, parsed.body, job.sourceText);

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
  ensureKeywordsAppear('task', parsed.keywords, parsed.body, job.sourceText);

  const lower = parsed.body.toLowerCase();
  const includesBlocked = TASK_NON_AI_PHRASES.some((phrase) => lower.includes(phrase));

  return {
    text: capsule.trim(),
    needsTaskReprompt: includesBlocked,
  };
}
