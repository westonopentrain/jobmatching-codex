import dotenv from 'dotenv';

dotenv.config();

export function getEnv(name: string): string | undefined {
  const value = process.env[name];

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

  }
  return undefined;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

export function getEnvNumber(name: string, defaultValue: number): number {
  const raw = getEnv(name);
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return parsed;
}
