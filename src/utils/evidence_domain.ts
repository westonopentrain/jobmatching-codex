import { logger } from './logger';

export interface DomainEvidence {
  tokens: string[];
  phrases: string[];
}

const MAX_EVIDENCE_ITEMS = 80;

const SOFT_BLOCKLIST = new Set(
  [
    'accuracy',
    'accurate',
    'audience',
    'availability',
    'available',
    'communication',
    'communicate',
    'compassion',
    'compassionate',
    'empathy',
    'empathetic',
    'feedback',
    'flexibility',
    'flexible',
    'inclusivity',
    'inclusive',
    'logistics',
    'logistical',
    'pay',
    'payment',
    'schedule',
    'scheduling',
    'timeline',
    'timeframe',
    'availability',
    'deadline',
    'deadlines',
    'turnaround',
    'auditing',
    'audit',
    'quality',
    'reliability',
    'accessible',
    'accessibility',
    'refine',
    'refinement',
    'review',
    'reviews',
    'validate',
    'validation',
    'validator',
    'validators',
    'resources',
    'resource',
    'experience',
    'experienced',
    'availability',
    'budget',
    'budgets',
    'cost',
    'costs',
    'pricing',
    'price',
  ].map((term) => term.toLowerCase())
);

const GENERIC_STOPWORDS = new Set(
  [
    'and',
    'the',
    'for',
    'with',
    'into',
    'from',
    'that',
    'this',
    'will',
    'including',
    'include',
    'ensures',
    'ensure',
    'ensuring',
    'support',
    'supports',
    'supporting',
    'provide',
    'providing',
    'provides',
    'across',
    'such',
    'other',
    'various',
    'ability',
    'must',
    'should',
    'strong',
    'team',
    'teams',
    'global',
    'detail',
    'detailed',
    'details',
    'detail-oriented',
    'orientation',
    'knowledge',
    'background',
    'skill',
    'skills',
    'capability',
    'capabilities',
    'work',
    'working',
    'role',
    'roles',
    'responsible',
    'responsibility',
    'responsibilities',
    'manage',
    'managing',
    'management',
    'lead',
    'leading',
    'leadership',
    'teamwork',
    'collaboration',
    'collaborative',
    'ability',
    'title',
    'instruction',
    'instructions',
    'reviewer',
    'description',
    'descriptions',
    'guidance',
    'requirement',
    'requirements',
    'additional',
    'content',
    'focusing',
    'focus',
    'focused',
    'hold',
    'holds',
    'holding',
    'have',
    'has',
    'completed',
    'complete',
    'completes',
    'maintain',
    'maintains',
    'maintaining',
    'board',
    'certification',
    'certifications',
    'project',
    'projects',
    'data',
    'dataset',
    'datasets',
    'job',
    'jobs',
    'role',
    'roles',
  ].map((term) => term.toLowerCase())
);

const CREDENTIAL_TERMS = [
  'MD',
  'DO',
  'RN',
  'NP',
  'PA',
  'JD',
  'LLM',
  'LLB',
  'DDS',
  'DMD',
  'DVM',
  'PhD',
  'Ph.D',
  'MBA',
  'MPH',
  'MSN',
  'MS',
  'BSN',
  'BS',
  'BA',
  'CPA',
  'CFA',
  'CFP',
  'CMA',
  'CISA',
  'CISM',
  'CISSP',
  'PMP',
  'PMI-ACP',
  'CSM',
  'CSPO',
  'SAFe',
  'FRM',
  'PE',
  'MRCOG',
  'FACS',
  'FACC',
  'ABOG',
];

const STANDARD_TERMS = [
  'HIPAA',
  'GDPR',
  'CCPA',
  'IFRS',
  'GAAP',
  'SOX',
  'ISO 13485',
  'ISO 27001',
  'SOC 2',
  'SOC2',
  'SOC-2',
  'IEC 62304',
  'FDA',
  'EMA',
  'Board certification',
  'Board-certified',
];

const STACK_TERMS = [
  'HTML',
  'CSS',
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C#',
  'C++',
  'Go',
  'Rust',
  'Ruby',
  'PHP',
  'SQL',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'React',
  'Vue',
  'Angular',
  'Node.js',
  'Django',
  'Flask',
  'Spring',
  'Laravel',
  'Swift',
  'Kotlin',
  'Objective-C',
];

const HUMAN_LANGUAGE_REGEX = /\b(english|spanish|german|french|portuguese|italian|arabic|mandarin|cantonese|japanese|korean|hindi|bengali|urdu|russian|ukrainian|polish|turkish|swahili|amharic|yoruba|hausa|tagalog|thai|vietnamese|malay|indonesian|farsi|persian|hebrew|swedish|norwegian|danish|finnish|dutch|romanian|greek|czech|slovak|hungarian|serbian|croatian|bulgarian|catalan|quechua|gujarati|punjabi|marathi|telugu|tamil|malayalam|kannada|lao|khmer|burmese|somali|zulu|xhosa|afrikaans|nepali|sinhala|icelandic|maori|samoan|tongan)\b/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeToken(token: string): string {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

function isCredential(token: string): boolean {
  return CREDENTIAL_TERMS.some((term) => term.toLowerCase() === token.toLowerCase());
}

function isStandard(token: string): boolean {
  return STANDARD_TERMS.some((term) => term.toLowerCase() === token.toLowerCase());
}

function isStackToken(token: string): boolean {
  return STACK_TERMS.some((term) => term.toLowerCase() === token.toLowerCase());
}

function isHumanLanguage(token: string): boolean {
  return HUMAN_LANGUAGE_REGEX.test(token);
}

function isSoftBlocked(token: string): boolean {
  return SOFT_BLOCKLIST.has(token.toLowerCase());
}

function isStopword(token: string): boolean {
  return GENERIC_STOPWORDS.has(token.toLowerCase());
}

function shouldKeepToken(rawToken: string): boolean {
  const token = normalizeToken(rawToken);
  if (!token) {
    return false;
  }

  const lower = token.toLowerCase();
  if (isSoftBlocked(lower)) {
    return false;
  }

  if (/^\d/.test(token)) {
    return false;
  }

  if (token.length <= 2 && !/^[A-Z0-9]+$/.test(token)) {
    return false;
  }

  if (isStopword(lower)) {
    return false;
  }

  return true;
}

function formatToken(token: string): string {
  if (/^[A-Z0-9\-]+$/.test(token)) {
    return token.toUpperCase();
  }
  return token.toLowerCase();
}

function addToken(token: string, seen: Set<string>, output: string[]): void {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return;
  }
  const key = normalized.toLowerCase();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  output.push(formatToken(normalized));
}

function addPhrase(phrase: string, seen: Set<string>, output: string[]): void {
  const trimmed = phrase.trim();
  if (!trimmed) {
    return;
  }
  const key = trimmed.toLowerCase();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  output.push(trimmed);
}

function collectCandidates(jobText: string): { tokens: string[]; phrases: string[] } {
  const tokenSeen = new Set<string>();
  const phraseSeen = new Set<string>();
  const tokens: string[] = [];
  const phrases: string[] = [];

  if (!jobText || jobText.trim().length === 0) {
    return { tokens, phrases };
  }

  const credentialRegex = new RegExp(`\\b(${CREDENTIAL_TERMS.map(escapeRegex).join('|')})\\b`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = credentialRegex.exec(jobText)) !== null) {
    addToken(match[1] ?? match[0], tokenSeen, tokens);
  }

  const standardsRegex = new RegExp(`\\b(${STANDARD_TERMS.map(escapeRegex).join('|')})\\b`, 'gi');
  while ((match = standardsRegex.exec(jobText)) !== null) {
    addToken(match[1] ?? match[0], tokenSeen, tokens);
  }

  const stackRegex = new RegExp(`\\b(${STACK_TERMS.map(escapeRegex).join('|')})\\b`, 'gi');
  while ((match = stackRegex.exec(jobText)) !== null) {
    addToken(match[1] ?? match[0], tokenSeen, tokens);
  }

  const generalWordRegex = /[A-Za-z][A-Za-z0-9+/'&.-]*/g;
  while ((match = generalWordRegex.exec(jobText)) !== null) {
    const raw = match[0];
    if (!shouldKeepToken(raw)) {
      continue;
    }
    addToken(raw, tokenSeen, tokens);
  }

  const phraseRegex = /([A-Za-z][A-Za-z0-9+/'&.-]*(?:\s+[A-Za-z][A-Za-z0-9+/'&.-]*){1,4})/g;
  while ((match = phraseRegex.exec(jobText)) !== null) {
    const rawPhrase = match[1]?.trim();
    if (!rawPhrase) {
      continue;
    }

    const words = rawPhrase
      .split(/\s+/)
      .map((word) => normalizeToken(word))
      .filter((word) => word.length > 0);

    if (words.length === 0) {
      continue;
    }

    if (words.some((word) => isSoftBlocked(word) || isStopword(word))) {
      continue;
    }

    const containsMeaningful = words.some((word) => word.length > 3 || /[-/]/.test(word));
    if (!containsMeaningful) {
      continue;
    }

    const phrase = words.map((word) => formatToken(word)).join(' ');
    addPhrase(phrase, phraseSeen, phrases);
  }

  if (phrases.length === 0) {
    // Attempt to build two-word phrases from adjacent tokens in the original text.
    const fallbackWords = jobText.split(/[^A-Za-z0-9+/'&.-]+/).filter((word) => shouldKeepToken(word));
    for (let i = 0; i < fallbackWords.length - 1 && phrases.length < MAX_EVIDENCE_ITEMS; i += 1) {
      const first = formatToken(normalizeToken(fallbackWords[i]!));
      const second = formatToken(normalizeToken(fallbackWords[i + 1]!));
      if (first === second) {
        continue;
      }
      const combined = `${first} ${second}`.trim();
      if (!combined || combined.split(' ').some((word) => isSoftBlocked(word) || isStopword(word))) {
        continue;
      }
      addPhrase(combined, phraseSeen, phrases);
    }
  }

  if (tokens.length > MAX_EVIDENCE_ITEMS) {
    tokens.length = MAX_EVIDENCE_ITEMS;
  }

  if (phrases.length > MAX_EVIDENCE_ITEMS) {
    phrases.length = MAX_EVIDENCE_ITEMS;
  }

  return { tokens, phrases };
}

export function extractDomainEvidence(jobText: string): DomainEvidence {
  try {
    const evidence = collectCandidates(jobText ?? '');

    // Ensure human languages only appear if explicitly referenced in subject matter context.
    const filteredTokens = evidence.tokens.filter((token) => {
      if (!isHumanLanguage(token)) {
        return true;
      }
      const windowRegex = new RegExp(`(.{0,80}${escapeRegex(token)}.{0,80})`, 'i');
      const match = windowRegex.exec(jobText);
      if (!match) {
        return false;
      }
      const windowText = match[1]?.toLowerCase() ?? '';
      return /content|corpus|dataset|data|subject matter|material|documents|linguistic|linguistics|terminology|translation|transcription/.test(
        windowText
      );
    });

    const filteredPhrases = evidence.phrases.filter((phrase) => {
      if (!isHumanLanguage(phrase)) {
        return true;
      }
      const windowRegex = new RegExp(`(.{0,80}${escapeRegex(phrase)}.{0,80})`, 'i');
      const match = windowRegex.exec(jobText);
      if (!match) {
        return false;
      }
      const windowText = match[1]?.toLowerCase() ?? '';
      return /content|corpus|dataset|data|subject matter|material|documents|linguistic|linguistics|terminology|translation|transcription/.test(
        windowText
      );
    });

    return {
      tokens: filteredTokens,
      phrases: filteredPhrases,
    };
  } catch (error) {
    logger.warn(
      {
        event: 'domain_evidence.extract_failure',
        message: (error as Error).message,
      },
      'Failed to extract domain evidence; returning empty evidence set'
    );
    return { tokens: [], phrases: [] };
  }
}
