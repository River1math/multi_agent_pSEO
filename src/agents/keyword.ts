import type { LlmGateway } from "../llm/gateway";
import { slugify } from "../lib/slug";
import {
  canonicalKeyFor,
  KeywordAgentInputSchema,
  KeywordDedupInputSchema,
  KeywordDedupSchema,
  KeywordExpansionSchema,
  type KeywordAgentInput,
  type KeywordAgentOutput,
  type KeywordCandidate,
  type KeywordSignals,
  type QueuedKeyword,
} from "../schemas";
import { payload } from "./render";

const EXPAND_SYSTEM = `You expand a seed topic into long-tail search queries for a software comparison site.

Each query becomes one page, so propose only queries where a page built from structured product data (pricing tiers, feature support, measured limits) would answer the searcher better than a vendor homepage does.

Three page types exist:
- versus: "[Tool A] vs [Tool B]" — exactly two named products.
- best_for: "Best [software category] for [specific niche]" — a category plus a narrow audience or constraint.
- alternatives: "[Tool] alternatives" — exactly one named product.

Use product slugs from known_entities when a product is among them; for any other product, give its name in kebab-case. Prefer niches that change which product wins (team size, budget, compliance, stack) over generic ones ("developers", "businesses").

Signals are estimates: you have no keyword-volume data, so choose a demand and competition tier you can justify in the rationale, leave searchVolume null and set volumeSource to "model_estimate".

Do not repeat anything in already_queued, in either word order.`;

const DEDUP_SYSTEM = `You are deduplicating a keyword queue for a programmatic SEO site. Two keywords are duplicates when one page would fully satisfy both searches — the same products or category, and niches that are the same audience under different words ("solo founders" / "indie hackers"). Niches that would change the recommendation ("startups" / "enterprises") are not duplicates.

For each duplicate pair, keep the keyword with the higher priority and report the other. Report nothing when in doubt: a missed duplicate is caught later by the uniqueness check, while a false one loses a page.`;

const TIER_WEIGHT = { high: 1, medium: 0.6, low: 0.3, unknown: 0.4 } as const;
const INTENT_WEIGHT = { commercial: 1, transactional: 1, informational: 0.6, navigational: 0.2 } as const;

/** Queue priority, 0–100. Computed here rather than by the model so it is comparable across runs. */
export function priorityFor(signals: KeywordSignals, intent: KeywordCandidate["intent"]): number {
  const base =
    0.4 * TIER_WEIGHT[signals.demand] +
    0.35 * (signals.commercialValue / 5) +
    0.25 * (1 - TIER_WEIGHT[signals.competition]);
  return Math.round(base * INTENT_WEIGHT[intent] * 1000) / 10;
}

export interface KeywordAgentContext {
  /** Slugified name or alias → entity slug. */
  entityAliases: ReadonlyMap<string, string>;
  knownCategories: ReadonlySet<string>;
  alreadyQueued: ReadonlyArray<{ canonicalKey: string; phrase: string }>;
}

function shapeProblem(candidate: KeywordCandidate): string | null {
  const count = candidate.entitySlugs.length;
  if (candidate.pageType === "versus" && (count !== 2 || candidate.entitySlugs[0] === candidate.entitySlugs[1])) {
    return "a versus keyword needs two different products";
  }
  if (candidate.pageType === "alternatives" && count !== 1) return "an alternatives keyword needs one product";
  if (candidate.pageType === "best_for" && (!candidate.categorySlug || !candidate.modifier)) {
    return "a best_for keyword needs a category and a niche";
  }
  return null;
}

/**
 * Keyword & SERP Intent Agent: expand → resolve entities → canonical-key dedup (code) →
 * near-duplicate pass (model) → prioritized queue.
 */
export async function runKeywordAgent(
  llm: LlmGateway,
  rawInput: KeywordAgentInput,
  context: KeywordAgentContext,
): Promise<KeywordAgentOutput> {
  const input = KeywordAgentInputSchema.parse(rawInput);

  const expansion = await llm.generate({
    task: "keyword.expand",
    schema: KeywordExpansionSchema,
    system: EXPAND_SYSTEM,
    prompt: [
      payload("seed_topic", input.seedTopic),
      payload("known_entities", input.knownEntitySlugs),
      payload("already_queued", input.existingCanonicalKeys),
      `Propose up to ${input.maxCandidates} queries.`,
    ].join("\n\n"),
    input,
  });

  const output: KeywordAgentOutput = { queued: [], duplicates: [], skipped: [] };
  const taken = new Map(context.alreadyQueued.map((keyword) => [keyword.canonicalKey, keyword.phrase]));
  const unique: QueuedKeyword[] = [];

  for (const candidate of expansion.data.candidates) {
    const problem = shapeProblem(candidate);
    if (problem) {
      output.skipped.push({ phrase: candidate.phrase, reason: problem });
      continue;
    }
    const resolved = candidate.entitySlugs.map((slug) => context.entityAliases.get(slugify(slug)) ?? null);
    const unknown = candidate.entitySlugs.filter((_, index) => resolved[index] === null);
    if (unknown.length > 0) {
      output.skipped.push({ phrase: candidate.phrase, reason: `unknown entity: ${unknown.join(", ")}` });
      continue;
    }
    if (candidate.categorySlug && !context.knownCategories.has(candidate.categorySlug)) {
      output.skipped.push({ phrase: candidate.phrase, reason: `no entities in category: ${candidate.categorySlug}` });
      continue;
    }

    const entitySlugs = resolved.filter((slug): slug is string => slug !== null);
    const keyword: QueuedKeyword = {
      ...candidate,
      entitySlugs,
      canonicalKey: canonicalKeyFor({ ...candidate, entitySlugs }),
      priority: priorityFor(candidate.signals, candidate.intent),
    };

    const existing = taken.get(keyword.canonicalKey);
    if (existing !== undefined) {
      output.duplicates.push({
        candidate: keyword,
        duplicateOfKey: keyword.canonicalKey,
        detectedBy: "canonical_key",
        reason: `same canonical key as "${existing}"`,
      });
      continue;
    }
    taken.set(keyword.canonicalKey, keyword.phrase);
    unique.push(keyword);
  }

  if (unique.length === 0) return output;

  const dedupInput = KeywordDedupInputSchema.parse({
    candidates: unique.map(({ canonicalKey, phrase, priority }) => ({ canonicalKey, phrase, priority })),
    alreadyQueued: context.alreadyQueued,
  });
  const candidateKeys = new Set(unique.map((keyword) => keyword.canonicalKey));
  const allKeys = new Set([...candidateKeys, ...context.alreadyQueued.map((keyword) => keyword.canonicalKey)]);

  const dedup = await llm.generate({
    task: "keyword.dedup",
    schema: KeywordDedupSchema,
    system: DEDUP_SYSTEM,
    prompt: [payload("candidates", dedupInput.candidates), payload("already_queued", dedupInput.alreadyQueued)].join("\n\n"),
    input: dedupInput,
    validate: (data) =>
      data.duplicates.flatMap((pair) => [
        ...(candidateKeys.has(pair.canonicalKey) ? [] : [`"${pair.canonicalKey}" is not a candidate key`]),
        ...(allKeys.has(pair.duplicateOfKey) ? [] : [`"${pair.duplicateOfKey}" is not a known key`]),
        ...(pair.canonicalKey === pair.duplicateOfKey ? [`"${pair.canonicalKey}" cannot duplicate itself`] : []),
      ]),
  });

  const redundant = new Map(dedup.data.duplicates.map((pair) => [pair.canonicalKey, pair]));
  for (const keyword of unique) {
    const pair = redundant.get(keyword.canonicalKey);
    // A keyword stays queued if the one it supposedly duplicates was itself removed.
    if (pair && !redundant.has(pair.duplicateOfKey)) {
      output.duplicates.push({ candidate: keyword, duplicateOfKey: pair.duplicateOfKey, detectedBy: "model", reason: pair.reason });
    } else {
      output.queued.push(keyword);
    }
  }
  output.queued.sort((a, b) => b.priority - a.priority);
  return output;
}
