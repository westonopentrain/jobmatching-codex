const FIXED_SENTENCE =
  'No AI/LLM data-labeling, model training, or evaluation experience was provided in the source.';
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
  'meeting notes',
  'case management',
  'qa',
  'analysis',
  'analytics',
  'reporting',
  'paperwork',
  'administrative',
  'data cleaning',
  'copywriting',
  'content writing',
];

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
  return match[1]
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
      const allowed = /(label|annotation)\s+qa/i.test(body);
      if (allowed) {
        continue;
      }
      return term;
    }

    if (term === 'data cleaning') {
      if (/data cleaning for model training/i.test(body)) {
        continue;
      }
      return term;
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
