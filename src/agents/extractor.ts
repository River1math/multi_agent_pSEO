import type { LlmGateway } from "../llm/gateway";
import { pageDataIssues } from "../qa/integrity";
import { numbersIn } from "../qa/text";
import {
  ExtractorInputSchema,
  llmPageDataSchemaFor,
  PageDataInputSchema,
  PageDataSchema,
  ToolFactSheetSchema,
  type CostScenario,
  type Evidence,
  type ExtractorInput,
  type LlmPageData,
  type PageData,
  type PageDataInput,
  type PricingTier,
  type ToolFactSheet,
} from "../schemas";
import { payload } from "./render";

const FACT_SHEET_SYSTEM = `You extract a structured fact sheet about one software product from the source pages provided. The fact sheet is the single source of truth for every comparison page that mentions the product, so accuracy matters more than coverage.

Rules:
- State only what the sources state. For every pricing tier, feature and metric, set evidence.sourceUrl to the page it came from and evidence.asOf to that page's fetch date; use confidence "verified" for first-party pages and "reported" for third-party ones.
- When a source does not settle something, say so: feature support "unknown", nullable fields null. Use confidence "inferred" with a null sourceUrl only for a claim you believe but cannot point to in the sources; never for prices.
- Copy prices and quotas as written. Do not convert currencies, annualize, or round.
- For features, use exactly the featureKeys in feature_taxonomy, one entry each.
- Strengths and weaknesses each need a concrete fact in "because" — a limit, a price, a missing capability — not an adjective.
- Give every id as short kebab-case, unique within this fact sheet.`;

const PAGE_DATA_SYSTEM = `You turn product fact sheets into the structured data for one comparison page. The page's tables, verdict cards and FAQs are rendered directly from your output, and a separate writer adds prose around it, so this data is what makes the page worth reading.

Rules:
- Use only facts in the fact sheets. Every key difference, verdict, FAQ and ranking cites evidenceRefs: ids of your own matrix rows or of fact-sheet pricing tiers, metrics, strengths and weaknesses.
- Build the comparison matrix from dimensions where the products actually differ or where a buyer needs the exact value (entry price, seat price, quotas, model support). A row that reads the same for every product belongs in the matrix only when the sameness is itself the answer.
- Each matrix row needs a cell for every product on the page. Set winnerSlug only when one product is clearly better on that dimension; otherwise null.
- Verdicts are per use case: a specific persona and constraint, the product to pick, and the fact that decides it. If the answer flips under some condition, put the condition in caveat.
- FAQs are questions a searcher of this exact query would ask, answered directly from the data.
- Do not compute cost scenarios; they are derived separately.
- Give every id as short kebab-case, unique within the page, and not equal to any fact-sheet id.`;

/** Fact-sheet ids are namespaced by product, so they stay unique when several sheets meet on a page. */
function namespaceIds(sheet: ToolFactSheet): ToolFactSheet {
  const prefix = `${sheet.entitySlug}-`;
  const scoped = <T extends { id: string }>(item: T): T =>
    item.id.startsWith(prefix) ? item : { ...item, id: `${prefix}${item.id}`.slice(0, 80) };
  return {
    ...sheet,
    pricing: { ...sheet.pricing, tiers: sheet.pricing.tiers.map(scoped) },
    metrics: sheet.metrics.map(scoped),
    strengths: sheet.strengths.map(scoped),
    weaknesses: sheet.weaknesses.map(scoped),
  };
}

/**
 * Grounding check done in code: a citation must point at a provided source, and a cited price
 * must literally appear in that source. Anything else is downgraded to "inferred".
 */
function groundEvidence(sheet: ToolFactSheet, input: ExtractorInput): { sheet: ToolFactSheet; downgraded: number } {
  const contentByUrl = new Map(input.sources.map((source) => [source.url, source.content]));
  let downgraded = 0;
  const ungrounded: Evidence = { sourceUrl: null, asOf: null, confidence: "inferred" };

  const check = (evidence: Evidence, requiredNumbers: number[] = []): Evidence => {
    if (evidence.confidence === "inferred") return evidence;
    const content = evidence.sourceUrl ? contentByUrl.get(evidence.sourceUrl) : undefined;
    const present = content ? new Set(numbersIn(content).map((found) => found.value)) : null;
    if (!present || requiredNumbers.some((value) => !present.has(String(value)))) {
      downgraded++;
      return ungrounded;
    }
    return evidence;
  };
  const prices = (tier: PricingTier) =>
    [tier.priceUsdMonthly, tier.priceUsdAnnualPerMonth].filter((price): price is number => price !== null && price > 0);

  return {
    sheet: {
      ...sheet,
      pricing: {
        ...sheet.pricing,
        tiers: sheet.pricing.tiers.map((tier) => ({ ...tier, evidence: check(tier.evidence, prices(tier)) })),
      },
      features: sheet.features.map((feature) => ({ ...feature, evidence: check(feature.evidence) })),
      metrics: sheet.metrics.map((metric) => ({ ...metric, evidence: check(metric.evidence, [metric.value]) })),
    },
    downgraded,
  };
}

/** Structured Data & Entity Extractor, step 1: sources → fact sheet for one product. */
export async function extractFactSheet(
  llm: LlmGateway,
  rawInput: ExtractorInput,
  pageId: string | null,
): Promise<{ sheet: ToolFactSheet; model: string; downgradedClaims: number }> {
  const input = ExtractorInputSchema.parse(rawInput);
  const taxonomy = new Set(input.featureTaxonomy.map((feature) => feature.featureKey));

  const result = await llm.generate({
    task: "extractor.factSheet",
    schema: ToolFactSheetSchema,
    system: FACT_SHEET_SYSTEM,
    prompt: [
      payload("product", { entitySlug: input.entitySlug, name: input.entityName }),
      payload("feature_taxonomy", input.featureTaxonomy),
      ...input.sources.map((source) =>
        `<source url="${source.url}" kind="${source.kind}" fetched="${source.fetchedAt}">\n${source.content}\n</source>`,
      ),
    ].join("\n\n"),
    input,
    pageId,
    validate: (sheet) => [
      ...(sheet.entitySlug === input.entitySlug ? [] : [`entitySlug must be "${input.entitySlug}"`]),
      ...sheet.features.filter((feature) => !taxonomy.has(feature.featureKey)).map((feature) => `unknown featureKey "${feature.featureKey}"`),
    ],
  });

  const grounded = groundEvidence(namespaceIds(result.data), input);
  return { sheet: grounded.sheet, model: result.model, downgradedClaims: grounded.downgraded };
}

const SCENARIOS = [
  { id: "cost-solo-monthly", label: "Solo developer, monthly billing", seats: 1, billing: "monthly" },
  { id: "cost-team-10-annual", label: "Team of 10, annual billing", seats: 10, billing: "annual" },
] as const;

function tierPrice(tier: PricingTier, billing: "monthly" | "annual"): number | null {
  return billing === "annual" ? (tier.priceUsdAnnualPerMonth ?? tier.priceUsdMonthly) : tier.priceUsdMonthly;
}

/**
 * Monthly cost per product for fixed team shapes: the cheapest paid plan a team of that size can
 * buy. Plain arithmetic over the fact sheets, which is why no model is involved.
 */
export function computeCostScenarios(entitySlugs: readonly string[], sheets: readonly ToolFactSheet[]): CostScenario[] {
  return SCENARIOS.map((scenario) => ({
    ...scenario,
    costs: entitySlugs.map((entitySlug) => {
      const tiers = sheets.find((sheet) => sheet.entitySlug === entitySlug)?.pricing.tiers ?? [];
      const options = tiers
        .filter((tier) => tier.billingUnit === (scenario.seats > 1 ? "per_seat" : tier.billingUnit))
        .map((tier) => ({ tier, price: tierPrice(tier, scenario.billing) }))
        .filter((option): option is { tier: PricingTier; price: number } => option.price !== null && option.price > 0)
        .sort((a, b) => a.price - b.price);
      const cheapest = options[0];
      if (!cheapest) return { entitySlug, tierId: null, monthlyUsd: null, note: "No self-serve paid plan for this team size" };
      const multiplier = cheapest.tier.billingUnit === "per_seat" ? scenario.seats : 1;
      return {
        entitySlug,
        tierId: cheapest.tier.id,
        monthlyUsd: Math.round(cheapest.price * multiplier * 100) / 100,
        note: `${cheapest.tier.name} plan`,
      };
    }),
  }));
}

/** Structured Data & Entity Extractor, step 2: fact sheets → page data. */
export async function synthesizePageData(
  llm: LlmGateway,
  rawInput: PageDataInput,
  pageId: string | null,
): Promise<PageData> {
  const input = PageDataInputSchema.parse(rawInput);
  const { pageType } = input.keyword;

  const result = await llm.generate<LlmPageData>({
    task: "extractor.pageData",
    schema: llmPageDataSchemaFor[pageType],
    system: PAGE_DATA_SYSTEM,
    prompt: [
      payload("keyword", input.keyword),
      payload("page_entities", input.entitySlugs),
      payload("feature_taxonomy", input.featureTaxonomy),
      payload("fact_sheets", input.factSheets),
    ].join("\n\n"),
    input,
    pageId,
    validate: (data) => pageDataIssues(data, input.entitySlugs, input.factSheets),
  });

  const pageData = PageDataSchema.parse({
    ...result.data,
    costScenarios: computeCostScenarios(input.entitySlugs, input.factSheets),
  });
  const issues = pageDataIssues(pageData, input.entitySlugs, input.factSheets);
  if (issues.length > 0) throw new Error(`page data failed integrity check after cost scenarios: ${issues.join("; ")}`);
  return pageData;
}
