import { z } from "zod";
import { PageTypeSchema, SlugSchema } from "./common";
import { DraftContentSchema, RevisionContextSchema } from "./draft";
import { ToolFactSheetSchema } from "./entity";
import { PageDataSchema } from "./page-data";
import { DeterministicSignalsSchema } from "./qa";

/** Input contracts for the page-level agents. Every agent parses its input before calling a model. */

const FeatureTaxonomySchema = z.array(
  z.object({ featureKey: SlugSchema, label: z.string(), group: z.string() }),
);

/** An already-approved page, shown to the drafter (to avoid) and the gatekeeper (to compare). */
export const SiblingExcerptSchema = z.object({
  slug: SlugSchema,
  title: z.string(),
  entityNames: z.array(z.string()),
  headings: z.array(z.string()),
  prose: z.string().max(6000),
});

export const PageDataInputSchema = z.object({
  keyword: z.object({
    phrase: z.string(),
    pageType: PageTypeSchema,
    categorySlug: SlugSchema.nullable(),
    modifier: z.string().nullable(),
  }),
  /** In the order the page should present them. */
  entitySlugs: z.array(SlugSchema).min(1),
  factSheets: z.array(ToolFactSheetSchema).min(1),
  featureTaxonomy: FeatureTaxonomySchema,
});

export const DrafterInputSchema = z.object({
  pageSlug: SlugSchema,
  keywordPhrase: z.string(),
  pageData: PageDataSchema,
  factSheets: z.array(ToolFactSheetSchema).min(1),
  siblings: z.array(SiblingExcerptSchema).max(3),
  revision: RevisionContextSchema.nullable(),
});

export const GatekeeperInputSchema = z.object({
  pageSlug: SlugSchema,
  keywordPhrase: z.string(),
  attempt: z.int().min(0).max(2),
  draft: DraftContentSchema,
  pageData: PageDataSchema,
  factSheets: z.array(ToolFactSheetSchema).min(1),
  signals: DeterministicSignalsSchema,
  siblings: z.array(SiblingExcerptSchema).max(3),
});

export type SiblingExcerpt = z.infer<typeof SiblingExcerptSchema>;
export type PageDataInput = z.infer<typeof PageDataInputSchema>;
export type DrafterInput = z.infer<typeof DrafterInputSchema>;
export type GatekeeperInput = z.infer<typeof GatekeeperInputSchema>;
