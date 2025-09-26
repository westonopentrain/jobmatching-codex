import { describe, expect, it, afterEach } from 'vitest';
import { getEnv } from '../src/utils/env';

describe('getEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns undefined when the env var is missing', () => {
    delete process.env.TEST_ENV_VAR;
    expect(getEnv('TEST_ENV_VAR')).toBeUndefined();
  });

  it('returns undefined when the env var is an empty string', () => {
    process.env.TEST_ENV_VAR = '';
    expect(getEnv('TEST_ENV_VAR')).toBeUndefined();
  });

  it('returns undefined when the env var is whitespace', () => {
    process.env.TEST_ENV_VAR = '   ';
    expect(getEnv('TEST_ENV_VAR')).toBeUndefined();
  });

  it('returns the trimmed value when the env var has content', () => {
    process.env.TEST_ENV_VAR = '  value  ';
    expect(getEnv('TEST_ENV_VAR')).toBe('value');
  });
});
