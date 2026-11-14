import { z } from "zod";
import { EvidenceSchema, RefIdSchema, SlugSchema } from "./common";

/**
 * Fact sheet for the default vertical: "AI Developer Tools & SaaS Comparisons".
 * One sheet per product, extracted from fetched sources and reused by every page that mentions
 * the product. A new vertical supplies its own fact-sheet schema through the vertical registry;
 * the page-data, draft and QA schemas stay the same.
 */

export const ToolCategorySchema = z.enum([
  "ai-code-editor",
  "ide-extension",
  "cli-coding-agent",
  "code-review",
  "app-builder",
  "llm-api-platform",
  "agent-framework",
  "llm-observability",
  "other",
]);

export const PricingTierSchema = z.object({
  id: RefIdSchema,
  name: z.string().max(60),
  priceUsdMonthly: z
    .number()
    .nonnegative()
    .nullable()
    .describe("List price per billing unit on monthly billing. Null = custom / contact sales."),
  priceUsdAnnualPerMonth: z.number().nonnegative().nullable(),
  billingUnit: z.enum(["per_seat", "flat", "usage", "custom"]),
  usageLimits: z.array(z.string().max(140)).describe("Quotas exactly as the vendor states them"),
  keyInclusions: z.array(z.string().max(140)).max(8),
  evidence: EvidenceSchema,
});

export const PricingSchema = z.object({
  model: z.enum(["free", "freemium", "subscription", "usage_based", "hybrid", "enterprise_only"]),
  hasFreeTier: z.boolean(),
  freeTrialDays: z.int().positive().nullable(),
  tiers: z.array(PricingTierSchema).min(1).max(8),
  caveats: z.array(z.string().max(200)).describe("Overage rules, seat minimums, credit expiry"),
});

export const FeatureSupportSchema = z.object({
  /** Key from the vertical's feature taxonomy, so the same feature lines up across products. */
  featureKey: SlugSchema,
  support: z.enum(["yes", "partial", "no", "unknown"]),
  detail: z.string().max(200).nullable().describe("The specific limit or condition, if any"),
  evidence: EvidenceSchema,
});

export const QuantMetricSchema = z.object({
  id: RefIdSchema,
  label: z.string().max(80),
  value: z.number(),
  unit: z.string().max(24),
  context: z.string().max(200).describe("How and by whom it was measured"),
  higherIsBetter: z.boolean().nullable(),
  evidence: EvidenceSchema,
});

export const AssessmentPointSchema = z.object({
  id: RefIdSchema,
  claim: z.string().max(140),
  because: z.string().max(240).describe("The concrete fact behind the claim; no adjectives alone"),
});

export const ToolFactSheetSchema = z.object({
  entitySlug: SlugSchema,
  name: z.string().max(80),
  vendor: z.string().max(80),
  websiteUrl: z.url(),
  category: ToolCategorySchema,
  positioning: z.string().max(200).describe("What it is and for whom, stated factually"),
  launchedYear: z.int().min(1990).max(2100).nullable(),
  openSource: z.boolean().nullable(),
  license: z.string().max(40).nullable(),
  deployment: z.array(z.enum(["cloud", "self_hosted", "local", "air_gapped"])).min(1),
  platforms: z.array(z.string().max(40)),
  modelsSupported: z.array(z.string().max(60)).describe("LLMs selectable by the user"),
  bringYourOwnKey: z.boolean().nullable(),
  integrations: z.array(z.string().max(60)),
  compliance: z.array(z.enum(["soc2", "iso27001", "gdpr", "hipaa", "sso_saml", "zero_retention"])),
  pricing: PricingSchema,
  features: z.array(FeatureSupportSchema).min(6),
  metrics: z.array(QuantMetricSchema),
  strengths: z.array(AssessmentPointSchema).min(2).max(6),
  weaknesses: z.array(AssessmentPointSchema).min(2).max(6),
  bestFor: z.array(z.string().max(120)).min(1).max(5),
  notIdealFor: z.array(z.string().max(120)).min(1).max(5),
  tags: z.array(SlugSchema).min(2).max(12),
});

export const ExtractorInputSchema = z.object({
  entitySlug: SlugSchema,
  entityName: z.string(),
  featureTaxonomy: z.array(z.object({ featureKey: SlugSchema, label: z.string() })),
  sources: z
    .array(z.object({ url: z.url(), kind: z.string(), fetchedAt: z.iso.date(), content: z.string() }))
    .min(1),
});

export type PricingTier = z.infer<typeof PricingTierSchema>;
export type FeatureSupport = z.infer<typeof FeatureSupportSchema>;
export type QuantMetric = z.infer<typeof QuantMetricSchema>;
export type ToolFactSheet = z.infer<typeof ToolFactSheetSchema>;
export type ExtractorInput = z.infer<typeof ExtractorInputSchema>;
