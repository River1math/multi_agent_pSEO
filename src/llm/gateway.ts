import type { AgentName } from "../generated/prisma/enums";
import type { Logger } from "../lib/log";
import { describeError, LlmValidationError } from "./errors";
import { ConcurrencyLimiter } from "./limiter";
import { costUsd, MODEL_TIERS, routeFor, type LlmTask, type ModelTier } from "./models";
import { DEFAULT_RETRY, withRetry, type RetryOptions } from "./retry";
import type { LlmRequest, LlmResult, LlmTransport, TransportResponse } from "./types";

export interface CallRecord {
  task: LlmTask;
  agent: AgentName;
  model: string;
  tier: ModelTier;
  pageId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
  stopReason: string | null;
  retries: number;
  error: string | null;
}

export interface GatewayOptions {
  transport: LlmTransport;
  log: Logger;
  /** Max in-flight model calls across every agent and page. */
  concurrency?: number;
  retry?: Partial<RetryOptions>;
  /** Called once per transport call, successful or not; the pipeline writes these to AgentCall. */
  onCall?: (record: CallRecord) => void | Promise<void>;
}

/** After a schema failure the model gets one repair call with the validation errors attached. */
const MAX_REPAIR_CALLS = 1;

/**
 * Every model call in the system goes through here: tier routing, concurrency limit, backoff on
 * rate limits, Zod validation of the output, one repair pass, and cost accounting.
 */
export class LlmGateway {
  private readonly limiter: ConcurrencyLimiter;
  private readonly retry: RetryOptions;

  constructor(private readonly options: GatewayOptions) {
    this.limiter = new ConcurrencyLimiter(options.concurrency ?? 4);
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
  }

  get transportName(): string {
    return this.options.transport.name;
  }

  async generate<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const route = routeFor(request.task, request.attempt ?? 0);
    const model = MODEL_TIERS[route.tier].id;
    const scope = `llm ${request.task}`;
    let feedback: string[] | null = null;

    for (let repair = 0; ; repair++) {
      const startedAt = Date.now();
      const record = (response: TransportResponse | null, retries: number, error: string | null) =>
        this.options.onCall?.({
          task: request.task,
          agent: route.agent,
          model: response?.model ?? model,
          tier: route.tier,
          pageId: request.pageId ?? null,
          inputTokens: response?.usage.inputTokens ?? 0,
          outputTokens: response?.usage.outputTokens ?? 0,
          cacheReadTokens: response?.usage.cacheReadTokens ?? 0,
          cacheWriteTokens: response?.usage.cacheWriteTokens ?? 0,
          costUsd: response ? costUsd(route.tier, response.usage) : 0,
          latencyMs: Date.now() - startedAt,
          stopReason: response?.stopReason ?? null,
          retries,
          error,
        });

      let response: TransportResponse;
      let retries = 0;
      try {
        const outcome = await this.limiter.run(() =>
          withRetry(
            () =>
              this.options.transport.complete({
                task: request.task,
                model,
                tier: route.tier,
                effort: route.effort,
                maxTokens: route.maxTokens,
                schema: request.schema,
                system: request.system,
                prompt: request.prompt,
                input: request.input,
                validationFeedback: feedback,
              }),
            {
              ...this.retry,
              onRetry: ({ attempt, delayMs, error }) => {
                retries = attempt;
                this.options.log.warn(
                  scope,
                  `${describeError(error)} → backoff ${delayMs}ms (retry ${attempt}/${this.retry.maxAttempts - 1})`,
                );
              },
            },
          ),
        );
        response = outcome.value;
      } catch (error) {
        await record(null, retries, describeError(error));
        throw error;
      }

      const parsed = request.schema.safeParse(response.json);
      const issues = parsed.success
        ? (request.validate?.(parsed.data) ?? [])
        : parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);

      if (parsed.success && issues.length === 0) {
        await record(response, retries, null);
        return { data: parsed.data, model: response.model, tier: route.tier };
      }

      await record(response, retries, `validation: ${issues.slice(0, 3).join("; ")}`);
      if (repair >= MAX_REPAIR_CALLS) throw new LlmValidationError(request.task, issues);
      this.options.log.warn(
        scope,
        `output rejected by ${parsed.success ? "integrity check" : "Zod schema"} (${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues[0]}) → repair call`,
      );
      feedback = issues;
    }
  }
}
