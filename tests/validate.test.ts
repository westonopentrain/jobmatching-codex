import { describe, expect, it } from 'vitest';
import {
  validateTaskCapsule,
  NO_EVIDENCE_TASK_CAPSULE,
} from '../src/services/validate';

describe('validateTaskCapsule', () => {
  it('replaces with fixed sentence when no evidence but text differs', () => {
    const result = validateTaskCapsule('Some task text\nKeywords: example', new Set());
    expect(result.ok).toBe(true);
    expect(result.text).toBe(NO_EVIDENCE_TASK_CAPSULE);
    expect(result.violations).toContain('NO_EVIDENCE_EXPECTED_FIXED_SENTENCE');
  });

  it('replaces when keywords include tokens outside evidence', () => {
    const evidence = new Set(['ner', 'label studio']);
    const text = 'Detailed NER annotation for reports.\nKeywords: ner, reports';
    const result = validateTaskCapsule(text, evidence);
    expect(result.text).toBe(NO_EVIDENCE_TASK_CAPSULE);
    expect(result.violations).toEqual(
      expect.arrayContaining(['KEYWORD_NOT_IN_EVIDENCE:reports'])
    );
  });

  it('replaces when blocklisted phrase appears without evidence context', () => {
    const evidence = new Set(['ner']);
    const text =
      'Handled NER tagging alongside clinical data review for operations.\nKeywords: ner';
    const result = validateTaskCapsule(text, evidence);
    expect(result.text).toBe(NO_EVIDENCE_TASK_CAPSULE);
    expect(result.violations).toEqual(
      expect.arrayContaining(['BLOCKLIST_TERM:clinical data review'])
    );
  });

  it('allows valid task capsule when aligned with evidence', () => {
    const evidence = new Set(['ner', 'label studio']);
    const text =
      'Executed NER labeling on de-identified case notes using Label Studio for model training.\nKeywords: ner, label studio';
    const result = validateTaskCapsule(text, evidence);
    expect(result.text).toBe(text.trim());
    expect(result.violations).toHaveLength(0);
  });
});
