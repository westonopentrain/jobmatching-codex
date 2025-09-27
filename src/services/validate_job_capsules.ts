import { getOpenAIClient } from './openai-client';
import { resolveCapsuleModel } from './openai-model';
import { withRetry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { DomainEvidence } from '../utils/evidence_domain';
import { LabelingEvidenceResult } from '../utils/evidence';

const KEYWORD_MIN = 10;
const KEYWORD_MAX = 20;
const MAX_REWRITE_ATTEMPTS = 3;

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

const DOMAIN_SOFT_TERMS = [
  'accuracy',
  'accurate',
  'audience',
  'communication',
  'communicate',
  'communication skills',
  'empathy',
  'empathetic',
  'resource',
  'resources',
  'reliability',
  'accessible',
  'accessibility',
  'quality',
  'quality review',
  'quality assurance',
  'review',
  'reviews',
  'refine',
  'refinement',
  'validation',
  'validate',
  'availability',
  'schedule',
  'scheduling',
  'timeline',
  'deadline',
  'deadlines',
  'turnaround',
  'budget',
  'budgets',
  'cost',
  'costs',
];

const TASK_LOGISTICS_TERMS = [
  'freelance labelers',
  'freelance annotators',
  'number of labelers',
  'labels per file',
  'total labels',
  'availability',
  'available hours',
  'schedule',
  'scheduling',
  'time requirement',
  'weekly hours',
  'hourly rate',
  'rate per hour',
  'payment',
  'pay rate',
  'budget',
  'budgeted',
  'countries',
  'country restrictions',
  'english level',
  'language requirement',
  'open availability',
  'start date',
  'end date',
  'OpenTrain AI',
  'employment',
  'hiring',
  'compensation',
  'salary',
  'benefits',
];

const ANGLE_BRACKET_REGEX = /[<>]/;
const BULLET_REGEX = /(^|\n)\s*[-•]/;

interface CapsuleParts {
  body: string;
  keywords: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCapsule(raw: string): CapsuleParts {
  const trimmed = raw.trim();
  const match = trimmed.match(/([\s\S]*?)\nKeywords:\s*(.+)$/i);
  if (!match) {
    return { body: trimmed, keywords: [] };
  }

  const body = match[1]?.trim() ?? '';
  const keywordLine = match[2]?.trim() ?? '';
  const keywords = keywordLine
    .split(/[;,]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (keywords.length === 0 && keywordLine.length > 0) {
    return {
      body,
      keywords: keywordLine
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0),
    };
  }

  return { body, keywords };
}

function buildTermRegex(term: string): RegExp {
  const escaped = escapeRegExp(term);
  if (term.includes(' ')) {
    return new RegExp(escaped.replace(/\\\s+/g, '\\s+').replace(/\\-/g, '[-\\s]+'), 'i');
  }
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

function sanitizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}

function hasBlockedTerm(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => {
    const normalized = term.toLowerCase();
    if (normalized.includes(' ')) {
      return lower.includes(normalized);
    }
    const regex = new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'i');
    return regex.test(text);
  });
}

function countWords(text: string): number {
  if (!text) {
    return 0;
  }
  const matches = text.trim().match(/[A-Za-z0-9][A-Za-z0-9+/'&.-]*/g);
  return matches ? matches.length : 0;
}

function combineEvidenceTerms(evidence: DomainEvidence | LabelingEvidenceResult): string[] {
  const seen = new Set<string>();
  const combined: string[] = [];
  for (const list of [evidence.phrases, evidence.tokens]) {
    for (const term of list) {
      const trimmed = term.trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      combined.push(trimmed);
    }
  }
  return combined;
}

function computeEvidenceKeywords(text: string, evidenceTerms: string[], limit: number): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();
  for (const term of evidenceTerms) {
    const cleaned = term.trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    const regex = buildTermRegex(cleaned);
    if (regex.test(text)) {
      matches.push(cleaned);
      seen.add(key);
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return matches;
}

export type RewriteCapsuleFn = (body: string, directive: string, evidence: string[]) => Promise<string>;

async function defaultRewriteCapsule(body: string, directive: string, evidence: string[]): Promise<string> {
  if (!directive.trim()) {
    return body;
  }
  if (evidence.length === 0) {
    return body;
  }
  const client = getOpenAIClient();
  const capsuleModel = resolveCapsuleModel();
  const evidenceBlock = evidence.join(', ');

  const completion = await withRetry(() =>
    client.chat.completions.create({
      model: capsuleModel,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'You rewrite job capsule paragraphs. Use only the provided evidence tokens. Output 1-2 sentences, no lists or brackets.',
        },
        {
          role: 'user',
          content: `Original paragraph:\n${body}\n\nAllowed evidence tokens:\n${evidenceBlock}\n\nRewrite as 1-2 sentences, no bullets or brackets. ${directive} Keep only tokens that appear in the evidence list.`,
        },
      ],
    })
  ).catch((error) => {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Failed to rewrite capsule text',
      details: { message: (error as Error).message },
    });
  });

  const rewritten = completion.choices?.[0]?.message?.content?.trim();
  if (!rewritten) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Rewrite attempt returned empty text',
    });
  }
  return sanitizeWhitespace(rewritten);
}

export interface DomainValidationContext {
  evidence: DomainEvidence;
}

export interface TaskValidationContext {
  evidence: LabelingEvidenceResult;
}

export interface CapsuleValidationOptions {
  rewrite?: RewriteCapsuleFn;
}

function ensureKeywordBounds(
  keywords: string[],
  evidenceTerms: string[],
  minCount: number
): { keywords: string[]; ok: boolean } {
  const unique = Array.from(new Set(keywords.map((token) => token.trim()).filter((token) => token.length > 0)));
  const limited = unique.slice(0, KEYWORD_MAX);
  const targetMin = Math.min(minCount, evidenceTerms.length);
  if (targetMin === 0) {
    return { keywords: limited.length > 0 ? limited : ['none'], ok: true };
  }
  if (limited.length < targetMin) {
    return { keywords: limited, ok: false };
  }
  return { keywords: limited, ok: true };
}

function formatKeywordsLine(keywords: string[], evidenceTerms: string[]): string {
  if (keywords.length === 1 && keywords[0]?.toLowerCase() === 'none') {
    return 'Keywords: none';
  }
  const allowed = new Set(evidenceTerms.map((term) => term.toLowerCase()));
  const filtered = keywords.filter((keyword) => allowed.has(keyword.toLowerCase()));
  if (filtered.length === 0) {
    return 'Keywords: none';
  }
  const limited = filtered.slice(0, KEYWORD_MAX);
  return `Keywords: ${limited.join(', ')}`;
}

async function enforceDomainCapsule(
  body: string,
  evidenceTerms: string[],
  rewrite: RewriteCapsuleFn
): Promise<{ body: string; keywords: string[] }> {
  let current = sanitizeWhitespace(body);

  for (let attempt = 0; attempt < MAX_REWRITE_ATTEMPTS; attempt += 1) {
    const directives: string[] = [];
    if (ANGLE_BRACKET_REGEX.test(current)) {
      directives.push('Remove angle brackets and keep plain sentences.');
    }
    if (BULLET_REGEX.test(current)) {
      directives.push('Remove bullet formatting; output sentences only.');
    }
    if (hasBlockedTerm(current, DOMAIN_AI_TERMS)) {
      directives.push('Remove AI/LLM terms; keep domain subject-matter nouns from DOMAIN_EVIDENCE only.');
    }
    if (hasBlockedTerm(current, DOMAIN_SOFT_TERMS)) {
      directives.push('Remove soft/logistics/meta terms; keep only domain nouns from DOMAIN_EVIDENCE.');
    }
    if (countWords(current) > 200) {
      directives.push('Keep the paragraph under 200 words.');
    }

    const matches = computeEvidenceKeywords(current, evidenceTerms, KEYWORD_MAX);
    const { ok } = ensureKeywordBounds(matches, evidenceTerms, KEYWORD_MIN);
    if (!ok && evidenceTerms.length > 0) {
      directives.push('Include additional distinct domain tokens from DOMAIN_EVIDENCE so at least ten appear.');
    }

    if (directives.length === 0) {
      return { body: current, keywords: matches };
    }

    if (evidenceTerms.length === 0) {
      break;
    }

    current = await rewrite(current, directives.join(' '), evidenceTerms);
  }

  const matches = computeEvidenceKeywords(current, evidenceTerms, KEYWORD_MAX);
  return { body: current, keywords: matches };
}

async function enforceTaskCapsule(
  body: string,
  evidenceTerms: string[],
  rewrite: RewriteCapsuleFn
): Promise<{ body: string; keywords: string[] }> {
  let current = sanitizeWhitespace(body);

  for (let attempt = 0; attempt < MAX_REWRITE_ATTEMPTS; attempt += 1) {
    const directives: string[] = [];
    if (ANGLE_BRACKET_REGEX.test(current)) {
      directives.push('Remove angle brackets and keep plain sentences.');
    }
    if (BULLET_REGEX.test(current)) {
      directives.push('Remove bullet formatting; output sentences only.');
    }
    if (hasBlockedTerm(current, TASK_LOGISTICS_TERMS)) {
      directives.push('Remove logistics/hiring/budget/schedule references; keep AI/LLM labeling/training/evaluation content from TASK_EVIDENCE.');
    }
    if (countWords(current) > 220) {
      directives.push('Keep the paragraph under 220 words.');
    }

    const matches = computeEvidenceKeywords(current, evidenceTerms, KEYWORD_MAX);
    const { ok } = ensureKeywordBounds(matches, evidenceTerms, KEYWORD_MIN);
    if (!ok && evidenceTerms.length > 0) {
      directives.push('Include additional distinct AI/LLM task terms from TASK_EVIDENCE so at least ten appear.');
    }

    if (directives.length === 0) {
      return { body: current, keywords: matches };
    }

    if (evidenceTerms.length === 0) {
      break;
    }

    current = await rewrite(current, directives.join(' '), evidenceTerms);
  }

  const matches = computeEvidenceKeywords(current, evidenceTerms, KEYWORD_MAX);
  return { body: current, keywords: matches };
}

export async function validateDomainCapsuleText(
  capsule: string,
  context: DomainValidationContext,
  options?: CapsuleValidationOptions
): Promise<string> {
  const { body } = parseCapsule(capsule);
  if (!body) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Domain capsule text is empty',
    });
  }

  const evidenceTerms = combineEvidenceTerms(context.evidence);
  const rewriteFn = options?.rewrite ?? defaultRewriteCapsule;

  const result = await enforceDomainCapsule(body, evidenceTerms, rewriteFn);
  const { keywords, ok } = ensureKeywordBounds(result.keywords, evidenceTerms, KEYWORD_MIN);
  if (!ok && evidenceTerms.length >= KEYWORD_MIN) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Domain capsule does not include enough evidence tokens',
    });
  }

  const formattedBody = sanitizeWhitespace(result.body);
  const keywordsLine = formatKeywordsLine(keywords, evidenceTerms);
  return `${formattedBody}\n${keywordsLine}`;
}

export async function validateTaskCapsuleText(
  capsule: string,
  context: TaskValidationContext,
  options?: CapsuleValidationOptions
): Promise<string> {
  const { body } = parseCapsule(capsule);
  if (!body) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Task capsule text is empty',
    });
  }

  const evidenceTerms = combineEvidenceTerms(context.evidence);
  const rewriteFn = options?.rewrite ?? defaultRewriteCapsule;

  const result = await enforceTaskCapsule(body, evidenceTerms, rewriteFn);
  const { keywords, ok } = ensureKeywordBounds(result.keywords, evidenceTerms, KEYWORD_MIN);
  if (!ok && evidenceTerms.length >= KEYWORD_MIN) {
    throw new AppError({
      code: 'LLM_FAILURE',
      statusCode: 502,
      message: 'Task capsule does not include enough evidence tokens',
    });
  }

  const formattedBody = sanitizeWhitespace(result.body);
  const keywordsLine = formatKeywordsLine(keywords, evidenceTerms);
  return `${formattedBody}\n${keywordsLine}`;
}
