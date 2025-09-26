import { describe, expect, it } from 'vitest';
import { extractLabelingEvidence } from '../src/utils/evidence';

describe('extractLabelingEvidence', () => {
  it('returns empty arrays when no annotation terms exist', () => {
    const result = extractLabelingEvidence('Managed patient scheduling and clinic operations.');
    expect(result.tokens).toHaveLength(0);
    expect(result.phrases).toHaveLength(0);
  });

  it('captures evidence across tasks, tools, and training terms', () => {
    const source = `NER and bounding box annotation on code diffs using Label Studio; prompt writing for SFT; RLHF preference scoring.`;
    const result = extractLabelingEvidence(source);

    expect(result.tokens).toEqual(
      expect.arrayContaining(['ner', 'rlhf', 'sft', 'annotation', 'scoring'])
    );
    expect(result.phrases).toEqual(
      expect.arrayContaining(['label studio', 'prompt writing', 'bounding box'])
    );
  });

  it('captures expanded evidence terms across domains', () => {
    const source =
      'Conducted guideline QA and safety reviews for preference judgments using Label Studio Annotate; prepared code annotation and coreference resolution datasets.';
    const result = extractLabelingEvidence(source);

    expect(result.tokens).toEqual(
      expect.arrayContaining(['coreference', 'annotation'])
    );
    expect(result.phrases).toEqual(
      expect.arrayContaining([
        'guideline qa',
        'safety reviews',
        'preference judgments',
        'label studio',
        'code annotation',
      ])
    );
  });
});
