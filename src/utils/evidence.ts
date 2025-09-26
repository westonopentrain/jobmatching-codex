import { LABELING_EVIDENCE_ALLOWLIST, EvidenceCategory } from '../config/evidence';

export interface LabelingEvidenceResult {
  tokens: string[];
  phrases: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPhrase(term: string): boolean {
  return /[\s/-]/.test(term);
}

function buildRegex(term: string, phrase: boolean): RegExp {
  const escaped = escapeRegExp(term);
  if (phrase) {
    const pattern = escaped
      .replace(/\\\s+/g, '\\s+')
      .replace(/\\-/g, '[-\\s]+');
    return new RegExp(pattern, 'i');
  }
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

export function extractLabelingEvidence(source: string): LabelingEvidenceResult {
  if (!source || source.trim().length === 0) {
    return { tokens: [], phrases: [] };
  }

  const normalizedSource = source.toLowerCase();
  const tokenMatches = new Set<string>();
  const phraseMatches = new Set<string>();
  const categoryMatches: Record<EvidenceCategory, Set<string>> = {
    tasks: new Set<string>(),
    labelTypes: new Set<string>(),
    modalities: new Set<string>(),
    tools: new Set<string>(),
    llmTraining: new Set<string>(),
  };

  for (const [category, terms] of Object.entries(LABELING_EVIDENCE_ALLOWLIST) as [
    EvidenceCategory,
    string[]
  ][]) {
    for (const term of terms) {
      const phrase = isPhrase(term);
      const regex = buildRegex(term, phrase);
      if (regex.test(normalizedSource)) {
        if (phrase) {
          phraseMatches.add(term);
        } else {
          tokenMatches.add(term);
        }
        categoryMatches[category].add(term);
      }
    }
  }

  const hasNonModalEvidence = (['tasks', 'labelTypes', 'tools', 'llmTraining'] as EvidenceCategory[])
    .some((category) => categoryMatches[category].size > 0);

  if (!hasNonModalEvidence) {
    return { tokens: [], phrases: [] };
  }

  return {
    tokens: Array.from(tokenMatches),
    phrases: Array.from(phraseMatches),
  };
}
