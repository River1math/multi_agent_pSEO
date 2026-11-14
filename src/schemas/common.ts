import { z } from "zod";

/**
 * Conventions for every schema an LLM must produce (Claude structured outputs):
 * - no recursion, no `.optional()` — absent values are explicit `null`;
 * - length / numeric bounds are not enforceable by the API grammar, so the SDK strips them from
 *   the wire schema and Zod enforces them client-side on parse. A bound violation is therefore a
 *   retryable validation error, not something the model is physically prevented from emitting.
 */

export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase kebab-case")
  .max(80);

/** Local id an LLM assigns to an item so other items in the same payload can reference it. */
export const RefIdSchema = SlugSchema.describe(
  "Short kebab-case id, unique within this payload, e.g. 'row-free-tier-limits'",
);

export const ConfidenceSchema = z.enum([
  "verified", // stated on a fetched first-party source
  "reported", // stated on a fetched third-party source
  "inferred", // not backed by a fetched source; never rendered as a hard number
]);

/** Provenance attached to every price, metric and feature claim. */
export const EvidenceSchema = z.object({
  sourceUrl: z.url().nullable(),
  asOf: z.iso.date().nullable().describe("Date the source was fetched or published (YYYY-MM-DD)"),
  confidence: ConfidenceSchema,
});

export const PageTypeSchema = z.enum(["versus", "best_for", "alternatives"]);

export type Slug = z.infer<typeof SlugSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type PageType = z.infer<typeof PageTypeSchema>;
