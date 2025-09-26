const DEFAULT_DELAYS_MS = [200, 500, 1000];

function getStatusFromError(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const maybeStatus = (error as { status?: unknown }).status;
    if (typeof maybeStatus === 'number') {
      return maybeStatus;
    }
    const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof maybeStatusCode === 'number') {
      return maybeStatusCode;
    }
    const responseStatus = (error as { response?: { status?: number } }).response?.status;
    if (typeof responseStatus === 'number') {
      return responseStatus;
    }
  }
  return undefined;
}

function isRetryableError(error: unknown): boolean {
  const status = getStatusFromError(error);
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      const transientCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND']);
      if (transientCodes.has(code)) {
        return true;
      }
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  retries?: number;
  delaysMs?: number[];
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = DEFAULT_DELAYS_MS.length, delaysMs = DEFAULT_DELAYS_MS } = options;
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryableError(error)) {
        throw error;
      }
      const delayIndex = Math.min(attempt, Math.max(delaysMs.length - 1, 0));
      const fallbackIndex = Math.min(delayIndex, DEFAULT_DELAYS_MS.length - 1);
      const delayMs =
        delaysMs[delayIndex] ??
        DEFAULT_DELAYS_MS[fallbackIndex] ??
        DEFAULT_DELAYS_MS[DEFAULT_DELAYS_MS.length - 1]!;
      await delay(delayMs);
      attempt += 1;
    }
  }
  throw lastError;
}
