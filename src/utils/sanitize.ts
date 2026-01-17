const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4})/g;

export function stripBasicPII(value: string): string {
  return value.replace(EMAIL_REGEX, '').replace(PHONE_REGEX, '').replace(/\s+/g, ' ').trim();
}

export function truncateLongField(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit);
}

export function truncateResumeText(text: string): string {
  return text;
}

export function sanitizeStringArray(values?: string[]): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return values
    .map((value) => stripBasicPII(value))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function sanitizeOptionalString(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const sanitized = stripBasicPII(value);
  return sanitized.length > 0 ? sanitized : undefined;
}

export function sanitizeJobField(value: string | undefined, limit = 12_000): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const sanitized = truncateLongField(stripBasicPII(value), limit).trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

export function sanitizeJobStringArray(values: string[] | undefined, limit = 12_000): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return values
    .map((entry) => sanitizeJobField(entry, limit))
    .filter((entry): entry is string => Boolean(entry));
}

export function joinWithLineBreak(values: string[]): string {
  if (values.length === 0) {
    return 'None';
  }
  return values.join('\n');
}

export function joinLanguages(languages: string[]): string {
  if (languages.length === 0) {
    return 'None';
  }
  return languages.join(', ');
}

/**
 * Normalize language strings from Bubble format to simple language names.
 * Handles formats like:
 * - "Slovak - Proficiency Level = Native or Bilingual" → "Slovak"
 * - "English" → "English"
 * - Comma-separated within a single string → split into multiple
 *
 * Returns deduplicated array of language names.
 */
export function normalizeLanguages(languages?: string[]): string[] {
  if (!languages || languages.length === 0) {
    return [];
  }

  const normalized = new Set<string>();

  for (const lang of languages) {
    // Split by comma in case multiple languages are in one string
    const parts = lang.split(',');

    for (const part of parts) {
      // Extract language name before " - " if present
      const dashIndex = part.indexOf(' - ');
      const name = dashIndex > 0 ? part.slice(0, dashIndex) : part;
      const trimmed = name.trim();

      if (trimmed.length > 0) {
        normalized.add(trimmed);
      }
    }
  }

  return Array.from(normalized);
}
