import Anthropic from "@anthropic-ai/sdk";
import { MODEL_TIERS } from "../llm/models";
import type { EntitySeed } from "../verticals/types";
import type { FetchedSource, SourceFetcher } from "./types";

const MAX_CONTINUATIONS = 3;

/**
 * Fetches an entity's source pages with Claude's server-side web_fetch tool and keeps the raw
 * documents, so extraction runs on stored text and can be repeated without refetching.
 * Not exercised by the mock dry-run: type-checked against the SDK, not yet run against the API.
 */
export class ClaudeWebFetchSource implements SourceFetcher {
  readonly name = "claude-web-fetch";

  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async fetch(entity: EntitySeed): Promise<FetchedSource[]> {
    const kindByUrl = new Map(entity.sources.map((source) => [source.url, source.kind]));
    const request = `Fetch each of these pages with the web_fetch tool, then reply with the single word "done".\n${entity.sources
      .map((source) => `- ${source.url}`)
      .join("\n")}`;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: request }];
    const fetched: FetchedSource[] = [];

    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const response = await this.client.messages.create({
        // The current web_fetch tool version is not offered on the Haiku tier.
        model: MODEL_TIERS.balanced.id,
        max_tokens: 2000,
        tools: [
          {
            type: "web_fetch_20260209",
            name: "web_fetch",
            max_uses: entity.sources.length + 2,
            allowed_domains: [...new Set(entity.sources.map((source) => new URL(source.url).hostname))],
            max_content_tokens: 30_000,
          },
        ],
        messages,
      });

      for (const block of response.content) {
        // A failed fetch comes back as an error object in the same block type, not as an exception.
        if (block.type !== "web_fetch_tool_result" || block.content.type !== "web_fetch_result") continue;
        const source = block.content.content.source;
        if (source.type !== "text") continue;
        fetched.push({
          url: block.content.url,
          kind: kindByUrl.get(block.content.url) ?? "DOCS",
          content: source.data,
          fetchedAt: block.content.retrieved_at ? new Date(block.content.retrieved_at) : new Date(),
          httpStatus: 200,
        });
      }

      // The server-side tool loop paused; resending the turn resumes it.
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }

    return fetched;
  }
}
