import { describe, expect, it } from 'vitest';
codex/implement-user-capsule-upsert-service-261aor

import { sanitizeOptionalString, sanitizeStringArray, truncateResumeText } from '../src/utils/sanitize';

describe('sanitize utilities', () => {
  it('returns resume text unchanged regardless of length', () => {
    const longText = 'a'.repeat(20_000);
    const truncated = truncateResumeText(longText);
    expect(truncated).toBe(longText);
codex/implement-user-capsule-upsert-service-261aor

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
