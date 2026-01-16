import { resolveCapsuleModel } from './openai-model';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { createTextResponse } from './openai-responses';

const FIXED_SENTENCE =
  'No AI/LLM data-labeling, model training, or evaluation experience documented.';
const FIXED_KEYWORDS = 'Keywords: none';
export const NO_EVIDENCE_TASK_CAPSULE = `${FIXED_SENTENCE}\n${FIXED_KEYWORDS}`;

const BLOCKLIST_TERMS = [
  'data entry',
  'data capture',
  'documentation',
  'ehr',
  'ehr workflow',
  'clinical data review',
  'research study',
  'cohort study',
  'excel',
  'spreadsheet',
  'powerpoint',
  'meeting',
  'meetings',
  'meeting notes',
  'case management',
  'qa',
  'analysis',
  'analytics',
  'reporting',
  'paperwork',
  'administrative',
  'admin',
  'data cleaning',
  'copywriting',
  'content writing',
  'customer service',
];

const DOMAIN_BANNED_TERMS = [
  'instructor',
  'teacher',
  'manager',
  'director',
  'writer',
  'worked',
  'served',
  'role',
  'responsible',
  'taught',
  'organized',
  'designed',
  'facilitated',
  'supervised',
  'led',
  'company',
  'corporation',
  'method',
  'berlitz',
];

const DOMAIN_MONTH_REGEX =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const DOMAIN_YEAR_REGEX = /\b(19|20)\d{2}\b/;
const DOMAIN_KEYWORD_STOPWORDS = new Set(
  [
    'the',
    'and',
    'or',
    'of',
    'in',
    'for',
    'with',
    'to',
    'on',
    'by',
    'a',
    'an',
    'as',
    'using',
    'across',
    'including',
    'focused',
    'focus',
    'candidate',
    'profile',
    'capsule',
    'subject',
    'matter',
    'expertise',
    'experience',
    'skills',
    'background',
    'knowledge',
    'strengths',
    'capabilities',
    'competencies',
    'specialization',
    'specializations',
    'specialties',
    'specialty',
    'industry',
    'industries',
    'verticals',
    'domains',
    'domain',
    'practice',
    'practices',
    'areas',
    'area',
    'support',
    'solutions',
    'services',
    'global',
    'international',
    'regional',
    'local',
    'advanced',
    'comprehensive',
    'extensive',
    'highly',
    'deep',
    'expert',
    'proficiency',
    'strength',
    'core',
    'primary',
    'keywords',
    'line',
    'phrases',
    'sentence',
    'nouns',
    'noun',
    'telegraphic',
    'summary',
    'summary',
  ].map((token) => token.toLowerCase())
);

function splitDomainCapsule(text: string): { body: string; keywords: string | null } {
  const match = text.match(/([\s\S]*?)\nKeywords:\s*(.+)$/i);
  if (!match) {
    return { body: text.trim(), keywords: null };
  }

  const body = match[1]?.trim() ?? '';
  const keywords = match[2]?.trim() ?? null;
  return { body, keywords: keywords && keywords.length > 0 ? keywords : null };
}

function sanitizeDomainWhitespace(body: string): string {
  return body
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\s+;/g, ';')
    .replace(/;\s+/g, '; ')
    .replace(/,\s+/g, ', ')
    .trim();
}

function removeDomainBannedTerms(body: string): string {
  let updated = body;
  updated = updated.replace(/\bthe candidate\b/gi, '');
  for (const term of DOMAIN_BANNED_TERMS) {
    const regex = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
    updated = updated.replace(regex, '').replace(/\s{2,}/g, ' ');
  }
  updated = updated.replace(DOMAIN_MONTH_REGEX, '');
  updated = updated.replace(DOMAIN_YEAR_REGEX, '');
  return sanitizeDomainWhitespace(updated);
}

function countWords(body: string): number {
  if (!body) {
    return 0;
  }
  return body
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length;
}

function domainNeedsRewrite(body: string): boolean {
  if (!body) {
    return false;
  }

  const lower = body.toLowerCase();
  if (DOMAIN_MONTH_REGEX.test(lower) || DOMAIN_YEAR_REGEX.test(lower)) {
    return true;
  }

  for (const term of DOMAIN_BANNED_TERMS) {
    const regex = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) {
      return true;
    }
  }

  return countWords(body) > 120;
}

function cleanKeywordCandidate(candidate: string): string | undefined {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return undefined;
  }
  const stripped = trimmed.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  if (stripped.length === 0) {
    return undefined;
  }
  const lower = stripped.toLowerCase();
  if (DOMAIN_KEYWORD_STOPWORDS.has(lower)) {
    return undefined;
  }
  if (stripped.length <= 2) {
    return undefined;
  }
  return stripped;
}

function generateDomainKeywords(body: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const segments = body
    .split(/[;\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    const parts = segment
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (const part of parts) {
      const cleaned = cleanKeywordCandidate(part);
      if (!cleaned) {
        continue;
      }
      const lower = cleaned.toLowerCase();
      if (seen.has(lower)) {
        continue;
      }
      seen.add(lower);
      candidates.push(cleaned);
      if (candidates.length >= 20) {
        return candidates;
      }
    }
  }

  if (candidates.length < 10) {
    const wordRegex = /\b[A-Za-z0-9][A-Za-z0-9+\/'&.-]*\b/g;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(body)) !== null) {
      const word = match[0];
      const lower = word.toLowerCase();
      if (seen.has(lower) || DOMAIN_KEYWORD_STOPWORDS.has(lower) || word.length <= 2) {
        continue;
      }
      seen.add(lower);
      candidates.push(word);
      if (candidates.length >= 20) {
        break;
      }
    }
  }

  return candidates;
}

function buildDomainCapsule(body: string): string {
  const sanitizedBody = sanitizeDomainWhitespace(body);
  const cleanedBody = sanitizedBody.length > 0 ? sanitizedBody : body.trim();
  if (cleanedBody.length === 0) {
    return 'Keywords: none';
  }
  const keywords = generateDomainKeywords(cleanedBody);
  if (keywords.length === 0) {
    return `${cleanedBody}\nKeywords: none`;
  }

  const limited = keywords.slice(0, Math.min(20, keywords.length));
  return `${cleanedBody}\nKeywords: ${limited.join(', ')}`;
}

async function rewriteDomainCapsuleSafe(text: string): Promise<string | null> {
  const capsuleModel = resolveCapsuleModel();
  try {
    const rewritten = await withRetry(() =>
      createTextResponse({
        model: capsuleModel,
        messages: [
          {
            role: 'system',
            content:
              'You compress domain capsules to noun phrases only. Use only the provided text, keep it under 110 words, and end with a Keywords line containing nouns from the rewrite.',
          },
          {
            role: 'user',
            content: `Rewrite the following to a single compact line of domain/subject-matter nouns and noun phrases ONLY (no verbs, no roles or titles, no employers, no dates). Preserve only nouns drawn from the original text. End with "Keywords: ..." using nouns from the rewrite.\nTEXT:\n${text}`,
          },
        ],
        temperature: 0.1,
      })
    );
    return rewritten && rewritten.length > 0 ? rewritten : null;
  } catch (error) {
    logger.warn(
      {
        event: 'domain.rewrite_failure',
        message: (error as Error).message,
      },
      'Failed to rewrite domain capsule; using heuristic cleanup'
    );
    return null;
  }
}

function normalizeDomainCapsule(text: string): string {
  const { body } = splitDomainCapsule(text);
  return buildDomainCapsule(removeDomainBannedTerms(body));
}

export interface DomainCapsuleValidationResult {
  ok: boolean;
  revised: string;
}

export async function validateDomainCapsule(
  text: string
): Promise<DomainCapsuleValidationResult> {
  let current = normalizeDomainCapsule(text.trim());
  let attempts = 0;

  while (attempts < 2) {
    const { body } = splitDomainCapsule(current);
    if (!domainNeedsRewrite(body)) {
      return { ok: true, revised: current };
    }

    const rewritten = await rewriteDomainCapsuleSafe(current);
    if (!rewritten) {
      break;
    }

    current = normalizeDomainCapsule(rewritten);
    attempts += 1;
  }

  const finalCapsule = normalizeDomainCapsule(current);
  const { body } = splitDomainCapsule(finalCapsule);
  if (domainNeedsRewrite(body)) {
    const cleaned = buildDomainCapsule(removeDomainBannedTerms(body));
    return { ok: true, revised: cleaned };
  }

  return { ok: true, revised: finalCapsule };
}

export interface TaskCapsuleValidationResult {
  ok: boolean;
  violations: string[];
  text: string;
}

function normalizeEvidenceSet(evidenceSet: Set<string>): Set<string> {
  const normalized = new Set<string>();
  for (const item of evidenceSet) {
    normalized.add(item.toLowerCase());
  }
  return normalized;
}

function extractKeywords(taskText: string): string[] {
  const match = taskText.match(/Keywords:\s*(.+)$/i);
  if (!match) {
    return [];
  }
  const keywordText = match[1] ?? '';
  if (keywordText.trim().length === 0) {
    return [];
  }

  return keywordText
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function removeKeywordsLine(taskText: string): string {
  return taskText.replace(/Keywords:[^\n]*$/i, '').trim();
}

function containsBlocklistTerm(body: string): string | undefined {
  const lower = body.toLowerCase();

  for (const term of BLOCKLIST_TERMS) {
    const regex = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (!regex.test(lower)) {
      continue;
    }

    if (term === 'qa') {
      const sentences = body
        .split(/[\.?!\n\r]+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
      const allowedWordsRegex = /\b(annotation|annotations|annotator|annotators|labeling|labelling|labelers?|labelled|labeled|label)\b/i;
      let shouldFlag = false;

      for (const sentence of sentences) {
        if (!/\bqa\b/i.test(sentence)) {
          continue;
        }

        if (!allowedWordsRegex.test(sentence)) {
          shouldFlag = true;
          break;
        }
      }

      if (shouldFlag) {
        return term;
      }

      continue;
    }

    if (term === 'data cleaning') {
      if (/data cleaning for model training/i.test(body)) {
        continue;
      }
      return term;
    }

    if (term === 'copywriting' || term === 'content writing') {
      const sentences = body
        .split(/[\.?!\n\r]+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
      const allowedRegex = /\b(prompt writing|response evaluation|response rating)\b/i;
      let shouldFlag = false;

      for (const sentence of sentences) {
        if (!new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(sentence)) {
          continue;
        }

        if (!allowedRegex.test(sentence)) {
          shouldFlag = true;
          break;
        }
      }

      if (shouldFlag) {
        return term;
      }

      continue;
    }

    return term;
  }

  return undefined;
}

export function validateTaskCapsule(
  taskText: string,
  evidenceSet: Set<string>
): TaskCapsuleValidationResult {
  const trimmed = taskText.trim();
  const normalizedEvidence = normalizeEvidenceSet(evidenceSet);

  if (normalizedEvidence.size === 0) {
    if (trimmed === NO_EVIDENCE_TASK_CAPSULE) {
      return { ok: true, violations: [], text: NO_EVIDENCE_TASK_CAPSULE };
    }
    return {
      ok: true,
      violations: ['NO_EVIDENCE_EXPECTED_FIXED_SENTENCE'],
      text: NO_EVIDENCE_TASK_CAPSULE,
    };
  }

  const violations: string[] = [];
  const keywords = extractKeywords(trimmed);

  if (keywords.length === 0) {
    violations.push('MISSING_KEYWORDS');
  } else {
    for (const keyword of keywords) {
      if (!normalizedEvidence.has(keyword.toLowerCase())) {
        violations.push(`KEYWORD_NOT_IN_EVIDENCE:${keyword}`);
        break;
      }
    }
  }

  const body = removeKeywordsLine(trimmed);
  const blocklisted = containsBlocklistTerm(body);
  if (blocklisted) {
    violations.push(`BLOCKLIST_TERM:${blocklisted}`);
  }

  if (violations.length > 0) {
    return { ok: true, violations, text: NO_EVIDENCE_TASK_CAPSULE };
  }

  return { ok: true, violations: [], text: trimmed };
}
