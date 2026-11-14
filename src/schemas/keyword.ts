import { z } from "zod";
import { PageTypeSchema, SlugSchema, type PageType } from "./common";

export const SearchIntentSchema = z.enum([
  "informational",
  "commercial",
  "transactional",
  "navigational",
]);

const TierSchema = z.enum(["high", "medium", "low", "unknown"]);

/**
 * Demand signals. Without a keyword-data provider these are model estimates, so they are coarse
 * tiers rather than fake-precise volumes; `searchVolume` stays null until a provider fills it.
 */
export const KeywordSignalsSchema = z.object({
  demand: TierSchema,
  competition: TierSchema,
  commercialValue: z.int().min(1).max(5),
  serpFeatures: z.array(
    z.enum(["comparison_table", "featured_snippet", "people_also_ask", "reviews", "video", "forum"]),
  ),
  searchVolume: z.int().nonnegative().nullable(),
  volumeSource: z.enum(["provider", "model_estimate"]),
  rationale: z.string().max(280),
});

/** What the Keyword Agent's LLM call returns per candidate. */
export const KeywordCandidateSchema = z.object({
  phrase: z.string().min(3).max(120),
  pageType: PageTypeSchema,
  intent: SearchIntentSchema,
  entitySlugs: z
    .array(SlugSchema)
    .max(2)
    .describe("Named products in the phrase: 2 for versus, 1 for alternatives, 0 for best_for"),
  categorySlug: SlugSchema.nullable().describe(
    "Software category being ranked on a best_for page, e.g. 'ai-code-editor'. Null otherwise.",
  ),
  modifier: z
    .string()
    .max(80)
    .nullable()
    .describe("Niche / audience qualifier, e.g. 'solo founders' or 'monorepos'. Null for versus."),
  signals: KeywordSignalsSchema,
});

export const KeywordAgentInputSchema = z.object({
  verticalSlug: SlugSchema,
  seedTopic: z.string().min(2).max(120),
  knownEntitySlugs: z.array(SlugSchema),
  existingCanonicalKeys: z.array(z.string()).describe("Already queued; do not propose again"),
  maxCandidates: z.int().min(1).max(200),
});

export const KeywordExpansionSchema = z.object({
  candidates: z.array(KeywordCandidateSchema),
});

/** A candidate after code-side canonicalization and scoring; this is what gets upserted. */
export const QueuedKeywordSchema = KeywordCandidateSchema.extend({
  canonicalKey: z.string(),
  priority: z.number().min(0).max(100),
});

export const KeywordAgentOutputSchema = z.object({
  queued: z.array(QueuedKeywordSchema),
  duplicates: z.array(z.object({ phrase: z.string(), duplicateOfKey: z.string() })),
});

const normalizeModifier = (modifier: string): string =>
  modifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => !MODIFIER_STOPWORDS.has(w))
    .sort()
    .join("-");

const MODIFIER_STOPWORDS = new Set(["for", "the", "a", "an", "and", "of", "in", "with", "to"]);

/**
 * Deterministic semantic identity for a keyword. "Cursor vs Copilot" and "Copilot vs Cursor"
 * collapse to one key, as do word-order variants ("small fintech teams" / "fintech small teams").
 * Near-duplicates this misses ("startups" vs "early-stage companies") go to the LLM dedup pass.
 */
export function canonicalKeyFor(input: {
  pageType: PageType;
  entitySlugs: readonly string[];
  categorySlug: string | null;
  modifier: string | null;
}): string {
  const subject = [...input.entitySlugs].sort().join("|") || input.categorySlug || "";
  const modifier = input.modifier ? normalizeModifier(input.modifier) : "";
  return [input.pageType, subject, modifier].filter(Boolean).join(":");
}

export type KeywordSignals = z.infer<typeof KeywordSignalsSchema>;
export type KeywordCandidate = z.infer<typeof KeywordCandidateSchema>;
export type KeywordAgentInput = z.infer<typeof KeywordAgentInputSchema>;
export type QueuedKeyword = z.infer<typeof QueuedKeywordSchema>;
export type KeywordAgentOutput = z.infer<typeof KeywordAgentOutputSchema>;
