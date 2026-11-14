import Anthropic from "@anthropic-ai/sdk";
import { sleep } from "../../lib/log";
import {
  DrafterInputSchema,
  ExtractorInputSchema,
  GatekeeperInputSchema,
  KeywordAgentInputSchema,
  KeywordDedupInputSchema,
  PageDataInputSchema,
} from "../../schemas";
import type { LlmTask } from "../models";
import type { LlmTransport, TransportRequest, TransportResponse } from "../types";
import { simulateFactSheet } from "./fixtures";
import { simulateDraft, type DraftScenario } from "./simulate-drafter";
import { simulateReview } from "./simulate-gatekeeper";
import { simulateKeywordDedup, simulateKeywordExpansion } from "./simulate-keyword";
import { simulatePageData } from "./simulate-page-data";

export interface MockScript {
  /** Drafting behaviour per page slug; unlisted pages get a clean draft. */
  scenarios: Record<string, DraftScenario>;
  /** The first call of this task fails with a 429 carrying retry-after. */
  rateLimitOnceOn?: LlmTask;
  /** The first response to this task violates its schema. */
  invalidOutputOnceOn?: LlmTask;
  latencyMs?: number;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Simulated transport. It sits behind the same gateway as the live one, so routing, concurrency,
 * retries, schema validation and cost accounting all run for real; only the model is replaced.
 */
export class MockTransport implements LlmTransport {
  readonly name = "mock";
  private readonly seen = new Map<LlmTask, number>();
  private corrupted = false;

  constructor(private readonly script: MockScript) {}

  async complete(request: TransportRequest): Promise<TransportResponse> {
    const call = (this.seen.get(request.task) ?? 0) + 1;
    this.seen.set(request.task, call);

    if (this.script.rateLimitOnceOn === request.task && call === 1) {
      throw Anthropic.APIError.generate(
        429,
        { type: "error", error: { type: "rate_limit_error", message: "simulated rate limit" } },
        "simulated rate limit",
        new Headers({ "retry-after": "1" }),
      );
    }
    await sleep(this.script.latencyMs ?? 25);

    let json = this.simulate(request);
    if (this.script.invalidOutputOnceOn === request.task && !this.corrupted && !request.validationFeedback) {
      this.corrupted = true;
      json = this.corrupt(json);
    }

    return {
      json,
      model: request.model,
      stopReason: "end_turn",
      usage: {
        inputTokens: estimateTokens(request.prompt),
        outputTokens: estimateTokens(JSON.stringify(json)),
        // The system prompt is the cached prefix: written on a task's first call, read afterwards.
        cacheReadTokens: call > 1 ? estimateTokens(request.system) : 0,
        cacheWriteTokens: call > 1 ? 0 : estimateTokens(request.system),
      },
    };
  }

  private simulate(request: TransportRequest): unknown {
    switch (request.task) {
      case "keyword.expand":
        return simulateKeywordExpansion(KeywordAgentInputSchema.parse(request.input));
      case "keyword.dedup":
        return simulateKeywordDedup(KeywordDedupInputSchema.parse(request.input));
      case "extractor.factSheet":
        return simulateFactSheet(ExtractorInputSchema.parse(request.input));
      case "extractor.pageData":
        return simulatePageData(PageDataInputSchema.parse(request.input));
      case "drafter.draft":
      case "drafter.revise": {
        const input = DrafterInputSchema.parse(request.input);
        return simulateDraft(input, this.script.scenarios[input.pageSlug] ?? "clean");
      }
      case "gatekeeper.review":
        return simulateReview(GatekeeperInputSchema.parse(request.input));
    }
  }

  /** Breaks one length limit, the kind of slip a real model makes under a tight constraint. */
  private corrupt(json: unknown): unknown {
    if (json && typeof json === "object" && "title" in json && typeof json.title === "string") {
      return { ...json, title: `${json.title} — The Complete, Definitive Guide for Developers` };
    }
    return json;
  }
}
