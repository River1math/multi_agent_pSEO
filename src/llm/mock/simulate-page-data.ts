import type { LlmPageData, MatrixRow, PageDataInput, PricingTier, ToolFactSheet } from "../../schemas";

/** Cuts at a word boundary so simulated text always fits the schema's length limits. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,;:—-]+$/, "");
}

const RANK = { yes: 3, partial: 2, unknown: 1, no: 0 } as const;
const WORD = { yes: "Yes", partial: "Partial", unknown: "Not documented", no: "No" } as const;

const WHY: Record<string, string> = {
  "inline-completion": "Completions are the feature used most often, so limits here are felt every minute.",
  "agent-mode": "Agent mode decides whether the tool can carry a multi-file change or only suggest lines.",
  "codebase-indexing": "Without an index the assistant answers from open files and misses code elsewhere in the repo.",
  "background-agents": "Cloud agents let work continue while the laptop is closed, which changes how tasks are delegated.",
  "model-choice": "Model choice matters when one model is clearly better for your language or task.",
  "byo-api-key": "Your own key moves spend to the model provider and removes the vendor's usage caps.",
  "terminal-agent": "A terminal agent covers scripts, CI and servers where no editor is open.",
  "pr-review": "Built-in review catches issues at the pull request without buying a second tool.",
  "mcp-support": "MCP is how the agent reaches your database, tickets and internal docs.",
  "jetbrains-support": "A team on IntelliJ or PyCharm cannot adopt a tool that requires leaving the IDE.",
  "privacy-mode": "Zero retention is often a hard requirement before proprietary code can be sent to a model.",
  "self-hosted": "Self-hosting is the only option for teams that cannot send code to a vendor cloud.",
};

export const entryTier = (sheet: ToolFactSheet): PricingTier | null =>
  [...sheet.pricing.tiers].filter((tier) => (tier.priceUsdMonthly ?? 0) > 0).sort((a, b) => (a.priceUsdMonthly ?? 0) - (b.priceUsdMonthly ?? 0))[0] ?? null;
const seatTier = (sheet: ToolFactSheet): PricingTier | null =>
  [...sheet.pricing.tiers].filter((tier) => tier.billingUnit === "per_seat" && (tier.priceUsdMonthly ?? 0) > 0).sort((a, b) => (a.priceUsdMonthly ?? 0) - (b.priceUsdMonthly ?? 0))[0] ?? null;
const freeTier = (sheet: ToolFactSheet): PricingTier | null => sheet.pricing.tiers.find((tier) => tier.priceUsdMonthly === 0) ?? null;
const supportOf = (sheet: ToolFactSheet, featureKey: string) => sheet.features.find((feature) => feature.featureKey === featureKey);
const rankOf = (sheet: ToolFactSheet, featureKey: string) => RANK[supportOf(sheet, featureKey)?.support ?? "unknown"];

/** The single best (or cheapest) product on a dimension, or null on a tie. */
function soleBest(sheets: ToolFactSheet[], score: (sheet: ToolFactSheet) => number | null): string | null {
  const scored = sheets.flatMap((sheet) => {
    const value = score(sheet);
    return value === null ? [] : [{ slug: sheet.entitySlug, value }];
  });
  const best = Math.max(...scored.map((entry) => entry.value));
  const winners = scored.filter((entry) => entry.value === best);
  return scored.length > 1 && winners.length === 1 ? (winners[0]?.slug ?? null) : null;
}

function buildMatrix(sheets: ToolFactSheet[], input: PageDataInput): MatrixRow[] {
  const cells = (display: (sheet: ToolFactSheet) => string, numeric: (sheet: ToolFactSheet) => number | null = () => null) =>
    sheets.map((sheet) => ({ entitySlug: sheet.entitySlug, display: clip(display(sheet), 120), numeric: numeric(sheet) }));
  const price = (tier: PricingTier | null) => tier?.priceUsdMonthly ?? null;
  const negate = (value: number | null) => (value === null ? null : -value);

  const rows: MatrixRow[] = [
    {
      id: "row-entry-price",
      group: "pricing",
      dimension: "Cheapest paid plan",
      cells: cells((sheet) => { const tier = entryTier(sheet); return tier ? `$${tier.priceUsdMonthly}/mo (${tier.name})` : "No paid self-serve plan"; }, (sheet) => price(entryTier(sheet))),
      winnerSlug: soleBest(sheets, (sheet) => negate(price(entryTier(sheet)))),
      whyItMatters: "This is what an individual pays to get past the free limits.",
    },
    {
      id: "row-seat-price",
      group: "pricing",
      dimension: "Team plan, per seat",
      cells: cells((sheet) => { const tier = seatTier(sheet); return tier ? `$${tier.priceUsdMonthly}/seat/mo (${tier.name})` : "No self-serve team plan"; }, (sheet) => price(seatTier(sheet))),
      winnerSlug: soleBest(sheets, (sheet) => negate(price(seatTier(sheet)))),
      whyItMatters: "Seat price is the number that scales with headcount and drives the annual bill.",
    },
    {
      id: "row-free-tier",
      group: "pricing",
      dimension: "Free plan limits",
      cells: cells((sheet) => { const tier = freeTier(sheet); return tier ? `${tier.name}: ${tier.usageLimits.join("; ")}` : "No free plan"; }),
      winnerSlug: null,
      whyItMatters: "Free limits decide whether you can evaluate the tool on real work before paying.",
    },
    {
      id: "row-paid-allowance",
      group: "pricing",
      dimension: "Usage included on the cheapest paid plan",
      cells: cells((sheet) => entryTier(sheet)?.usageLimits.join("; ") ?? "—"),
      winnerSlug: null,
      whyItMatters: "Included usage determines how soon a heavy user hits overage charges.",
    },
  ];
  for (const feature of input.featureTaxonomy) {
    rows.push({
      id: `row-${feature.featureKey}`,
      group: feature.group as MatrixRow["group"],
      dimension: feature.label,
      cells: cells((sheet) => {
        const entry = supportOf(sheet, feature.featureKey);
        return `${WORD[entry?.support ?? "unknown"]}${entry?.detail ? ` — ${entry.detail}` : ""}`;
      }),
      winnerSlug: soleBest(sheets, (sheet) => rankOf(sheet, feature.featureKey)),
      whyItMatters: WHY[feature.featureKey] ?? "This capability changes which workflows the tool can cover.",
    });
  }
  return rows;
}

/** What a model would synthesize for one page: computed here by rule from the fact sheets. */
export function simulatePageData(input: PageDataInput): LlmPageData {
  const sheets = input.entitySlugs.flatMap((slug) => input.factSheets.find((sheet) => sheet.entitySlug === slug) ?? []);
  const first = sheets[0];
  if (!first) throw new Error("mock page data needs at least one fact sheet");
  const matrix = buildMatrix(sheets, input);
  const label = (featureKey: string) => input.featureTaxonomy.find((feature) => feature.featureKey === featureKey)?.label ?? featureKey;
  const priceText = (sheet: ToolFactSheet) => { const tier = entryTier(sheet); return tier ? `$${tier.priceUsdMonthly}/mo on ${tier.name}` : "custom pricing"; };
  const byEntryPrice = [...sheets].sort((a, b) => (entryTier(a)?.priceUsdMonthly ?? Infinity) - (entryTier(b)?.priceUsdMonthly ?? Infinity));
  const bySeatPrice = sheets.filter(seatTier).sort((a, b) => (seatTier(a)?.priceUsdMonthly ?? 0) - (seatTier(b)?.priceUsdMonthly ?? 0));
  const cheapest = byEntryPrice[0] ?? first;

  /** Features where the products differ, widest gap first. */
  const gaps = input.featureTaxonomy
    .map((feature) => {
      const ranks = sheets.map((sheet) => rankOf(sheet, feature.featureKey));
      return { featureKey: feature.featureKey, gap: Math.max(...ranks) - Math.min(...ranks) };
    })
    .filter((entry) => entry.gap > 0)
    .sort((a, b) => b.gap - a.gap);

  const useCaseVerdicts = [
    {
      id: "verdict-budget",
      useCase: "An individual developer paying out of pocket",
      pickSlug: cheapest.entitySlug,
      reasoning: clip(`${cheapest.name} is the cheapest way past the free limits at ${priceText(cheapest)}; ${byEntryPrice.slice(1).map((sheet) => `${sheet.name} is ${priceText(sheet)}`).join(", ")}.`, 320),
      caveat: clip(cheapest.weaknesses[0]?.because ?? "", 200) || null,
      evidenceRefs: ["row-entry-price"],
    },
    ...sheets.slice(0, 3).map((sheet) => ({
      id: `verdict-fit-${sheet.entitySlug}`,
      useCase: clip(sheet.bestFor[0] ?? `Teams choosing ${sheet.name}`, 120),
      pickSlug: sheet.entitySlug,
      reasoning: clip(`${sheet.strengths[0]?.because ?? sheet.positioning}.`, 320),
      caveat: clip(`Not ideal for: ${(sheet.notIdealFor[0] ?? "").toLowerCase()}.`, 200),
      evidenceRefs: [sheet.strengths[0]?.id ?? "row-entry-price"],
    })),
    ...(bySeatPrice[0]
      ? [{
          id: "verdict-team",
          useCase: "A team of 10 standardizing on one tool",
          pickSlug: bySeatPrice[0].entitySlug,
          reasoning: clip(`${bySeatPrice.map((sheet) => `${sheet.name} ${seatTier(sheet)?.name} is $${seatTier(sheet)?.priceUsdMonthly} per seat`).join("; ")}.`, 320),
          caveat: "Seat price is only the floor: metered agent usage is billed on top on every plan.",
          evidenceRefs: ["row-seat-price"],
        }]
      : []),
  ].slice(0, 6);

  const list = (render: (sheet: ToolFactSheet) => string) => sheets.map(render).join(" ");
  const subject = sheets.length === 2 ? `${sheets[0]?.name} or ${sheets[1]?.name}` : "these tools";
  const faqs = [
    {
      id: "faq-cheapest",
      question: clip(`Which is cheaper, ${subject}?`, 160),
      answer: clip(`${cheapest.name} has the lowest paid entry price at ${priceText(cheapest)}. ${list((sheet) => (sheet === cheapest ? "" : `${sheet.name} starts at ${priceText(sheet)}.`))}`.trim(), 480),
      evidenceRefs: ["row-entry-price"],
    },
    {
      id: "faq-free-plan",
      question: "Is there a free plan, and what does it include?",
      answer: clip(list((sheet) => { const tier = freeTier(sheet); return tier ? `${sheet.name} ${tier.name}: ${tier.usageLimits.join(", ").toLowerCase()}.` : `${sheet.name} has no free plan.`; }), 480),
      evidenceRefs: ["row-free-tier"],
    },
    {
      id: "faq-jetbrains",
      question: "Which of them work inside JetBrains IDEs?",
      answer: clip(list((sheet) => { const entry = supportOf(sheet, "jetbrains-support"); return `${sheet.name}: ${WORD[entry?.support ?? "unknown"].toLowerCase()}${entry?.detail ? ` (${entry.detail.toLowerCase()})` : ""}.`; }), 480),
      evidenceRefs: ["row-jetbrains-support"],
    },
    {
      id: "faq-own-key",
      question: "Can I use my own model API key?",
      answer: clip(list((sheet) => { const entry = supportOf(sheet, "byo-api-key"); return `${sheet.name}: ${WORD[entry?.support ?? "unknown"].toLowerCase()}${entry?.detail ? ` — ${entry.detail.toLowerCase()}` : ""}.`; }), 480),
      evidenceRefs: ["row-byo-api-key"],
    },
  ];

  const tags = [...new Set([...sheets.map((sheet) => sheet.category), ...sheets.flatMap((sheet) => sheet.tags.slice(0, 2)), ...gaps.slice(0, 3).map((gap) => gap.featureKey)])].slice(0, 12);
  const shared = { matrix, useCaseVerdicts, faqs, tags };
  const difference = (featureKey: string, id: string) => ({
    id,
    headline: clip(`${label(featureKey)}: ${sheets.map((sheet) => `${sheet.name} ${WORD[supportOf(sheet, featureKey)?.support ?? "unknown"].toLowerCase()}`).join(", ")}`, 90),
    detail: clip(list((sheet) => { const entry = supportOf(sheet, featureKey); return `${sheet.name}: ${entry?.detail ?? WORD[entry?.support ?? "unknown"]}.`; }), 320),
    evidenceRefs: [`row-${featureKey}`],
  });

  if (input.keyword.pageType === "versus") {
    const [a, b] = [sheets[0], sheets[1]];
    if (!a || !b) throw new Error("a versus page needs two fact sheets");
    const pricier = byEntryPrice[1] ?? b;
    const topGap = gaps.find((gap) => rankOf(pricier, gap.featureKey) > rankOf(cheapest, gap.featureKey)) ?? gaps[0];
    return {
      pageType: "versus",
      entitySlugs: [a.entitySlug, b.entitySlug],
      bottomLine: {
        overallPickSlug: null,
        summary: clip(`${cheapest.name} is the cheaper way in at ${priceText(cheapest)}; ${pricier.name} costs ${priceText(pricier)} and is the pick when ${label(topGap?.featureKey ?? "agent-mode").toLowerCase()} matters to you.`, 280),
      },
      keyDifferences: [
        { id: "diff-entry-price", headline: clip(`Entry price: ${a.name} ${priceText(a)}, ${b.name} ${priceText(b)}`, 90), detail: clip(`${a.name} ${entryTier(a)?.name} includes: ${entryTier(a)?.usageLimits.join(", ")}. ${b.name} ${entryTier(b)?.name} includes: ${entryTier(b)?.usageLimits.join(", ")}.`, 320), evidenceRefs: ["row-entry-price", "row-paid-allowance"] },
        ...gaps.slice(0, 3).map((gap) => difference(gap.featureKey, `diff-${gap.featureKey}`)),
      ],
      switching: { effort: "medium", notes: gaps.slice(0, 2).map((gap) => clip(`Check ${label(gap.featureKey).toLowerCase()} before moving: ${difference(gap.featureKey, "x").detail}`, 200)) },
      ...shared,
    };
  }

  if (input.keyword.pageType === "best_for") {
    const niche = input.keyword.modifier ?? "small teams";
    const fit = (sheet: ToolFactSheet) =>
      Math.max(0, Math.min(100, Math.round(62 - (entryTier(sheet)?.priceUsdMonthly ?? 40) + 5 * rankOf(sheet, "agent-mode") + 4 * rankOf(sheet, "byo-api-key") + 3 * rankOf(sheet, "background-agents"))));
    const ranked = [...sheets].sort((a, b) => fit(b) - fit(a));
    return {
      pageType: "best_for",
      niche: {
        label: clip(niche, 80),
        audience: clip(`${niche} choosing an AI code editor without a platform team behind them`, 160),
        constraints: ["Pays for tooling personally, so the entry price is felt directly", "No administrator, so billing and setup must be self-serve"],
      },
      criteria: [
        { id: "criterion-entry-price", criterion: "Entry price", weight: 5, whyForThisNiche: "One person carries the whole subscription, so the cheapest paid plan matters more than seat discounts." },
        { id: "criterion-agent", criterion: "Agent capability", weight: 4, whyForThisNiche: "Without teammates, an agent that carries multi-file changes is the main source of leverage." },
        { id: "criterion-own-key", criterion: "Own-key support", weight: 3, whyForThisNiche: "Paying the model provider directly keeps cost proportional to actual usage in quiet months." },
      ],
      ranked: ranked.map((sheet, index) => ({
        rank: index + 1,
        entitySlug: sheet.entitySlug,
        fitScore: fit(sheet),
        bestForSubsegment: clip(sheet.bestFor[0] ?? sheet.positioning, 120),
        whyItFits: clip(`${sheet.name} costs ${priceText(sheet)}. ${sheet.strengths[0]?.because ?? sheet.positioning}.`, 320),
        tradeoff: clip(`${sheet.weaknesses[0]?.because ?? "No notable tradeoff recorded"}.`, 200),
        recommendedTierId: entryTier(sheet)?.id ?? null,
        evidenceRefs: ["row-entry-price", sheet.strengths[0]?.id ?? "row-agent-mode"],
      })),
      ...shared,
    };
  }

  const [subjectSheet, ...others] = sheets;
  if (!subjectSheet) throw new Error("an alternatives page needs a subject");
  const featureNames = (other: ToolFactSheet, better: boolean) =>
    input.featureTaxonomy
      .filter((feature) => (better ? rankOf(other, feature.featureKey) > rankOf(subjectSheet, feature.featureKey) : rankOf(other, feature.featureKey) < rankOf(subjectSheet, feature.featureKey)))
      .map((feature) => feature.label);
  return {
    pageType: "alternatives",
    subjectSlug: subjectSheet.entitySlug,
    reasonsToSwitch: subjectSheet.weaknesses.slice(0, 5).map((weakness, index) => ({
      id: `reason-${index + 1}`,
      headline: clip(weakness.claim, 90),
      detail: clip(`${weakness.because}.`, 320),
      evidenceRefs: [weakness.id],
    })),
    alternatives: others.slice(0, 8).map((other) => ({
      entitySlug: other.entitySlug,
      chooseIf: clip(other.bestFor[0] ?? other.positioning, 200),
      betterThanSubject: featureNames(other, true).length > 0 ? featureNames(other, true) : [clip(other.strengths[0]?.claim ?? "Different pricing model", 160)],
      worseThanSubject: featureNames(other, false).length > 0 ? featureNames(other, false) : [clip(other.weaknesses[0]?.claim ?? "Smaller feature set", 160)],
      migrationEffort: other.tags.some((tag) => subjectSheet.tags.includes(tag) && tag === "vscode-fork") ? "low" : "medium",
      evidenceRefs: [other.strengths[0]?.id ?? "row-entry-price"],
    })),
    ...shared,
  };
}
