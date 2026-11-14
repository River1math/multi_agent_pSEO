import { z } from "zod";
import { RefIdSchema, SlugSchema } from "./common";

/**
 * Page-level structured data, synthesized from fact sheets. This is what makes each page distinct:
 * the template renders tables, verdicts and FAQs straight from it, and the Drafting Agent only
 * writes prose that interprets it. `evidenceRefs` point at ids inside this payload or the fact
 * sheets (pricing tier ids, metric ids, assessment ids) and are resolved in code.
 */

const EvidenceRefsSchema = z
  .array(RefIdSchema)
  .min(1)
  .describe("Ids of matrix rows, metrics, pricing tiers or assessment points backing this item");

export const MatrixRowSchema = z.object({
  id: RefIdSchema,
  group: z.enum(["pricing", "capabilities", "models", "workflow", "security", "ecosystem"]),
  dimension: z.string().max(80),
  cells: z
    .array(
      z.object({
        entitySlug: SlugSchema,
        display: z.string().max(120).describe("Cell text: the specific value, limit or yes/no"),
        numeric: z.number().nullable().describe("Sortable value when the cell is quantitative"),
      }),
    )
    .min(2),
  winnerSlug: SlugSchema.nullable().describe("Null when it is a tie or not comparable"),
  whyItMatters: z.string().max(200),
});

/** Monthly cost for a concrete team shape. Computed in code from pricing tiers, never by an LLM. */
export const CostScenarioSchema = z.object({
  id: RefIdSchema,
  label: z.string().max(80),
  seats: z.int().positive(),
  billing: z.enum(["monthly", "annual"]),
  costs: z.array(
    z.object({
      entitySlug: SlugSchema,
      tierId: RefIdSchema.nullable(),
      monthlyUsd: z.number().nonnegative().nullable().describe("Null when pricing is custom"),
      note: z.string().max(160).nullable(),
    }),
  ),
});

export const UseCaseVerdictSchema = z.object({
  id: RefIdSchema,
  useCase: z.string().max(120).describe("A specific persona + constraint, not a generic segment"),
  pickSlug: SlugSchema,
  reasoning: z.string().max(320),
  caveat: z.string().max(200).nullable(),
  evidenceRefs: EvidenceRefsSchema,
});

export const FaqSchema = z.object({
  id: RefIdSchema,
  question: z.string().max(160),
  answer: z.string().max(480).describe("Direct factual answer; the drafter may only tighten it"),
  evidenceRefs: EvidenceRefsSchema,
});

export const KeyDifferenceSchema = z.object({
  id: RefIdSchema,
  headline: z.string().max(90),
  detail: z.string().max(320),
  evidenceRefs: EvidenceRefsSchema,
});

const sharedSections = {
  matrix: z.array(MatrixRowSchema).min(8).max(24),
  costScenarios: z.array(CostScenarioSchema).max(4),
  useCaseVerdicts: z.array(UseCaseVerdictSchema).min(3).max(6),
  faqs: z.array(FaqSchema).min(4).max(8),
  tags: z.array(SlugSchema).min(2).max(12),
};

export const VersusPageDataSchema = z.object({
  pageType: z.literal("versus"),
  // An array, not z.tuple: tuples compile to `prefixItems`, which structured outputs reject.
  entitySlugs: z.array(SlugSchema).length(2),
  bottomLine: z.object({
    overallPickSlug: SlugSchema.nullable().describe("Null when the answer depends on use case"),
    summary: z.string().max(280),
  }),
  keyDifferences: z.array(KeyDifferenceSchema).min(3).max(6),
  switching: z
    .object({ effort: z.enum(["low", "medium", "high"]), notes: z.array(z.string().max(200)) })
    .nullable(),
  ...sharedSections,
});

export const BestForPageDataSchema = z.object({
  pageType: z.literal("best_for"),
  niche: z.object({
    label: z.string().max(80),
    audience: z.string().max(160),
    constraints: z.array(z.string().max(140)).min(2).describe("What this niche needs or lacks"),
  }),
  criteria: z
    .array(
      z.object({
        id: RefIdSchema,
        criterion: z.string().max(80),
        weight: z.int().min(1).max(5),
        whyForThisNiche: z.string().max(200),
      }),
    )
    .min(3)
    .max(7),
  ranked: z
    .array(
      z.object({
        rank: z.int().positive(),
        entitySlug: SlugSchema,
        fitScore: z.int().min(0).max(100),
        bestForSubsegment: z.string().max(120),
        whyItFits: z.string().max(320),
        tradeoff: z.string().max(200),
        recommendedTierId: RefIdSchema.nullable(),
        evidenceRefs: EvidenceRefsSchema,
      }),
    )
    .min(3)
    .max(10),
  ...sharedSections,
});

export const AlternativesPageDataSchema = z.object({
  pageType: z.literal("alternatives"),
  subjectSlug: SlugSchema,
  reasonsToSwitch: z.array(KeyDifferenceSchema).min(2).max(5),
  alternatives: z
    .array(
      z.object({
        entitySlug: SlugSchema,
        chooseIf: z.string().max(200),
        betterThanSubject: z.array(z.string().max(160)).min(1),
        worseThanSubject: z.array(z.string().max(160)).min(1),
        migrationEffort: z.enum(["low", "medium", "high"]),
        evidenceRefs: EvidenceRefsSchema,
      }),
    )
    .min(3)
    .max(8),
  ...sharedSections,
});

/** Stored form (Page.structuredData). Agents are called with the single variant for the page. */
export const PageDataSchema = z.discriminatedUnion("pageType", [
  VersusPageDataSchema,
  BestForPageDataSchema,
  AlternativesPageDataSchema,
]);

export const pageDataSchemaFor = {
  versus: VersusPageDataSchema,
  best_for: BestForPageDataSchema,
  alternatives: AlternativesPageDataSchema,
} as const;

/**
 * What the Extractor's model call returns: everything except cost scenarios, which are arithmetic
 * over pricing tiers and are therefore computed in code.
 */
export const llmPageDataSchemaFor = {
  versus: VersusPageDataSchema.omit({ costScenarios: true }),
  best_for: BestForPageDataSchema.omit({ costScenarios: true }),
  alternatives: AlternativesPageDataSchema.omit({ costScenarios: true }),
} as const;

export type LlmPageData =
  | z.infer<(typeof llmPageDataSchemaFor)["versus"]>
  | z.infer<(typeof llmPageDataSchemaFor)["best_for"]>
  | z.infer<(typeof llmPageDataSchemaFor)["alternatives"]>;

/** Entities a page covers, in display order. */
export function entitySlugsOf(data: PageData | LlmPageData): string[] {
  switch (data.pageType) {
    case "versus":
      return [...data.entitySlugs];
    case "best_for":
      return data.ranked.map((r) => r.entitySlug);
    case "alternatives":
      return [data.subjectSlug, ...data.alternatives.map((a) => a.entitySlug)];
  }
}

export type MatrixRow = z.infer<typeof MatrixRowSchema>;
export type CostScenario = z.infer<typeof CostScenarioSchema>;
export type UseCaseVerdict = z.infer<typeof UseCaseVerdictSchema>;
export type Faq = z.infer<typeof FaqSchema>;
export type VersusPageData = z.infer<typeof VersusPageDataSchema>;
export type BestForPageData = z.infer<typeof BestForPageDataSchema>;
export type AlternativesPageData = z.infer<typeof AlternativesPageDataSchema>;
export type PageData = z.infer<typeof PageDataSchema>;
