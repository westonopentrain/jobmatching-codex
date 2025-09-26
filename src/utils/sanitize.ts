const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4})/g;

function stripBasicPII(value: string): string {
  return value.replace(EMAIL_REGEX, '').replace(PHONE_REGEX, '').replace(/\s+/g, ' ').trim();
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
