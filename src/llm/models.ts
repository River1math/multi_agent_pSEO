import type { AgentName } from "../generated/prisma/enums";

export type ModelTier = "bulk" | "balanced" | "reasoning";
export type Effort = "low" | "medium" | "high";

export interface ModelSpec {
  id: string;
  /** USD per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  /** Server-side refusal fallback is not offered on the Haiku tier. */
  supportsRefusalFallback: boolean;
}

export const MODEL_TIERS: Record<ModelTier, ModelSpec> = {
  bulk: {
    id: "claude-haiku-5-5",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01, // assumed 0.1× input; confirm against the pricing page before budgeting
    supportsRefusalFallback: false,
  },
  balanced: {
    id: "claude-sonnet-5-5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.1,
    supportsRefusalFallback: true,
  },
  reasoning: {
    id: "claude-opus-5-5",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    supportsRefusalFallback: true,
  },
};

const CACHE_WRITE_MULTIPLIER = 1.25;

export type LlmTask =
  | "keyword.expand"
  | "keyword.dedup"
  | "extractor.factSheet"
  | "extractor.pageData"
  | "drafter.draft"
  | "drafter.revise"
  | "gatekeeper.review";

export interface Route {
  agent: AgentName;
  tier: ModelTier;
  effort: Effort;
  maxTokens: number;
}

const ROUTES: Record<LlmTask, Route> = {
  "keyword.expand": { agent: "KEYWORD", tier: "bulk", effort: "low", maxTokens: 8000 },
  "keyword.dedup": { agent: "KEYWORD", tier: "bulk", effort: "low", maxTokens: 4000 },
  "extractor.factSheet": { agent: "EXTRACTOR", tier: "balanced", effort: "medium", maxTokens: 16000 },
  "extractor.pageData": { agent: "EXTRACTOR", tier: "balanced", effort: "medium", maxTokens: 16000 },
  "drafter.draft": { agent: "DRAFTER", tier: "bulk", effort: "low", maxTokens: 8000 },
  "drafter.revise": { agent: "DRAFTER", tier: "bulk", effort: "low", maxTokens: 8000 },
  "gatekeeper.review": { agent: "GATEKEEPER", tier: "reasoning", effort: "high", maxTokens: 8000 },
};

/**
 * Tiered routing. The one dynamic rule: the last allowed revision is escalated from the bulk
 * model to the balanced one, since a page that failed twice on the cheap model is cheaper to fix
 * with a stronger model than to send to a human.
 */
export function routeFor(task: LlmTask, attempt = 0): Route {
  const route = ROUTES[task];
  if (task === "drafter.revise" && attempt >= 2) {
    return { ...route, tier: "balanced", effort: "medium" };
  }
  return route;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(tier: ModelTier, usage: Usage): number {
  const spec = MODEL_TIERS[tier];
  return (
    (usage.inputTokens * spec.inputPerMTok +
      usage.cacheWriteTokens * spec.inputPerMTok * CACHE_WRITE_MULTIPLIER +
      usage.cacheReadTokens * spec.cacheReadPerMTok +
      usage.outputTokens * spec.outputPerMTok) /
    1_000_000
  );
}
