import { describe, expect, it } from 'vitest';
import {
  getWorkLanguages,
  matchesJobLanguages,
  getLanguageFilterForPinecone,
} from '../src/utils/language-matching';

describe('getWorkLanguages', () => {
  it('filters out English from language list', () => {
    expect(getWorkLanguages(['Polish', 'English'])).toEqual(['Polish']);
    expect(getWorkLanguages(['English', 'Hungarian'])).toEqual(['Hungarian']);
    expect(getWorkLanguages(['Polish', 'Hungarian', 'English'])).toEqual(['Polish', 'Hungarian']);
  });

  it('handles case-insensitive English', () => {
    expect(getWorkLanguages(['Polish', 'ENGLISH'])).toEqual(['Polish']);
    expect(getWorkLanguages(['Polish', 'english'])).toEqual(['Polish']);
  });

  it('returns empty array for English-only list', () => {
    expect(getWorkLanguages(['English'])).toEqual([]);
  });

  it('returns all languages when no English present', () => {
    expect(getWorkLanguages(['Polish', 'Hungarian'])).toEqual(['Polish', 'Hungarian']);
  });

  it('handles empty array', () => {
    expect(getWorkLanguages([])).toEqual([]);
  });
});

describe('matchesJobLanguages', () => {
  describe('jobs with non-English work languages', () => {
    it('Polish+English job - English-only user does NOT match', () => {
      expect(matchesJobLanguages(['Polish', 'English'], ['English'])).toBe(false);
    });

    it('Polish+English job - Polish user DOES match', () => {
      expect(matchesJobLanguages(['Polish', 'English'], ['Polish'])).toBe(true);
    });

    it('Polish+English job - Polish+English user DOES match', () => {
      expect(matchesJobLanguages(['Polish', 'English'], ['Polish', 'English'])).toBe(true);
    });

    it('Polish+Hungarian+English job - Hungarian user DOES match', () => {
      expect(matchesJobLanguages(['Polish', 'Hungarian', 'English'], ['Hungarian'])).toBe(true);
    });

    it('Polish+Hungarian+English job - English-only user does NOT match', () => {
      expect(matchesJobLanguages(['Polish', 'Hungarian', 'English'], ['English'])).toBe(false);
    });

    it('handles case-insensitive matching', () => {
      expect(matchesJobLanguages(['Polish', 'English'], ['polish'])).toBe(true);
      expect(matchesJobLanguages(['POLISH', 'ENGLISH'], ['Polish'])).toBe(true);
    });
  });

  describe('English-only jobs', () => {
    it('English-only job - English user DOES match', () => {
      expect(matchesJobLanguages(['English'], ['English'])).toBe(true);
    });

    it('English-only job - non-English user does NOT match', () => {
      expect(matchesJobLanguages(['English'], ['Polish'])).toBe(false);
    });

    it('English-only job - Polish+English user DOES match', () => {
      expect(matchesJobLanguages(['English'], ['Polish', 'English'])).toBe(true);
    });
  });

  describe('jobs with no language requirements', () => {
    it('no-language job - any user DOES match', () => {
      expect(matchesJobLanguages([], ['English'])).toBe(true);
      expect(matchesJobLanguages([], ['Polish'])).toBe(true);
      expect(matchesJobLanguages([], [])).toBe(true);
    });
  });

  describe('users with no languages set', () => {
    it('user with no languages cannot match language-specific job', () => {
      expect(matchesJobLanguages(['Polish', 'English'], [])).toBe(false);
      expect(matchesJobLanguages(['English'], [])).toBe(false);
    });
  });
});

describe('getLanguageFilterForPinecone', () => {
  it('returns work languages when non-English languages exist', () => {
    expect(getLanguageFilterForPinecone(['Polish', 'English'])).toEqual(['Polish']);
    expect(getLanguageFilterForPinecone(['Polish', 'Hungarian', 'English'])).toEqual(['Polish', 'Hungarian']);
  });

  it('returns ["English"] for English-only jobs', () => {
    expect(getLanguageFilterForPinecone(['English'])).toEqual(['English']);
  });

  it('returns ["English"] for empty language list', () => {
    expect(getLanguageFilterForPinecone([])).toEqual(['English']);
  });
});
