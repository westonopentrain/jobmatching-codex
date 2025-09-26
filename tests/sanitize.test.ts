import { describe, expect, it } from 'vitest';
import {
  getResumeCharLimit,
  sanitizeOptionalString,
  sanitizeStringArray,
  truncateResumeText,
} from '../src/utils/sanitize';

describe('sanitize utilities', () => {
  it('truncates resume text to the configured limit', () => {
    const limit = getResumeCharLimit();
    const longText = 'a'.repeat(limit + 100);
    const truncated = truncateResumeText(longText);
    expect(truncated.length).toBe(limit);
  });

  it('strips obvious PII from structured arrays', () => {
    const values = sanitizeStringArray(['Email me at user@example.com', 'Call 123-456-7890']);
    expect(values).toEqual(['Email me at', 'Call']);
  });

  it('returns undefined when optional string becomes empty', () => {
    const sanitized = sanitizeOptionalString('123-456-7890');
    expect(sanitized).toBeUndefined();
  });
});
