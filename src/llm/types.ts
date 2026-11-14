import type { z } from "zod";
import type { Effort, LlmTask, ModelTier, Usage } from "./models";

/** One structured-output call, as an agent expresses it. */
export interface LlmRequest<T> {
  task: LlmTask;
  /** Drives escalation for revision calls; 0 elsewhere. */
  attempt?: number;
  schema: z.ZodType<T>;
  /** Stable instructions; sent as the cached prefix. */
  system: string;
  /** Per-call content; goes after the cache breakpoint. */
  prompt: string;
  /** The validated agent input the prompt was rendered from. The mock transport simulates from it. */
  input: unknown;
  /** Cross-field checks a JSON schema cannot express. Returned strings are fed back for repair. */
  validate?: (data: T) => string[];
  pageId?: string | null;
}

export interface TransportRequest {
  task: LlmTask;
  model: string;
  tier: ModelTier;
  effort: Effort;
  maxTokens: number;
  schema: z.ZodType;
  system: string;
  prompt: string;
  input: unknown;
  /** Present on a repair call: why the previous output was rejected. */
  validationFeedback: string[] | null;
}

export interface TransportResponse {
  json: unknown;
  model: string;
  stopReason: string | null;
  usage: Usage;
}

/** The only thing that differs between live and simulated runs. */
export interface LlmTransport {
  readonly name: string;
  complete(request: TransportRequest): Promise<TransportResponse>;
}

export interface LlmResult<T> {
  data: T;
  model: string;
  tier: ModelTier;
}
