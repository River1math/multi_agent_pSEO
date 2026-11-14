import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LlmRefusalError, LlmTruncatedError } from "./errors";
import { MODEL_TIERS } from "./models";
import type { LlmTransport, TransportRequest, TransportResponse } from "./types";

/**
 * Live transport. Not exercised by the mock dry-run: it type-checks against the installed SDK but
 * has not yet been run against the API.
 */
export class AnthropicTransport implements LlmTransport {
  readonly name = "anthropic";

  constructor(
    // Retries are owned by the gateway (logged, jittered, retry-after aware), so the SDK's are off.
    private readonly client: Anthropic = new Anthropic({ maxRetries: 0 }),
  ) {}

  async complete(request: TransportRequest): Promise<TransportResponse> {
    const prompt = request.validationFeedback
      ? `${request.prompt}\n\nYour previous output was rejected by validation:\n${request.validationFeedback
          .map((issue) => `- ${issue}`)
          .join("\n")}\nReturn a corrected output that fixes every issue above.`
      : request.prompt;

    const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: request.maxTokens,
      // The instructions are identical for every call of a task, so they are the cached prefix.
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
    };
    // On the tiers that support it, a policy decline is re-run server-side on a fallback model
    // instead of failing the page.
    if (MODEL_TIERS[request.tier].supportsRefusalFallback) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    const response = await this.client.beta.messages.create(params);

    if (response.stop_reason === "refusal") {
      throw new LlmRefusalError(request.task, response.stop_details?.category ?? null);
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmTruncatedError(request.task, request.maxTokens);
    }

    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null; // surfaces as a schema failure, which the gateway repairs once
    }

    return {
      json,
      model: response.model,
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
