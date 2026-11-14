import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";

/** The model's output did not satisfy the schema or integrity checks, even after a repair pass. */
export class LlmValidationError extends Error {
  constructor(
    readonly task: string,
    readonly issues: string[],
  ) {
    super(`${task}: output failed validation: ${issues.slice(0, 5).join("; ")}`);
    this.name = "LlmValidationError";
  }
}

export class LlmRefusalError extends Error {
  constructor(task: string, category: string | null) {
    super(`${task}: request declined (category: ${category ?? "unspecified"})`);
    this.name = "LlmRefusalError";
  }
}

export class LlmTruncatedError extends Error {
  constructor(task: string, maxTokens: number) {
    super(`${task}: output hit max_tokens (${maxTokens}) before completing`);
    this.name = "LlmTruncatedError";
  }
}

/** Rate limits, overload, 5xx and network failures are worth retrying; 4xx request errors are not. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) return true;
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    return status === 408 || status === 409 || (status !== undefined && status >= 500);
  }
  return false;
}

/** Server-advised wait, when the response carried one. */
export function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof Anthropic.APIError) || !error.headers) return null;
  const ms = Number(error.headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const seconds = Number(error.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return null;
}

export function describeError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return "429 rate limited";
  if (error instanceof Anthropic.APIError) return error.message;
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return `invalid data (${error.issues.length} issue(s)): ${first?.path.join(".") || "(root)"}: ${first?.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
