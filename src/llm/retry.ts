import { sleep } from "../lib/log";
import { isRetryable, retryAfterMs } from "./errors";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export const DEFAULT_RETRY: RetryOptions = { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 30_000 };

/** Exponential backoff with full jitter; a server-advised retry-after takes precedence. */
export function backoffDelayMs(attempt: number, options: RetryOptions, error?: unknown): number {
  const advised = retryAfterMs(error);
  if (advised !== null) return Math.min(advised, options.maxDelayMs);
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY,
): Promise<{ value: T; retries: number }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await operation(), retries: attempt - 1 };
    } catch (error) {
      if (!isRetryable(error) || attempt >= options.maxAttempts) throw error;
      const delayMs = backoffDelayMs(attempt, options, error);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
