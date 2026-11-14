import {
  entitySlugsOf,
  type DraftContent,
  type LlmPageData,
  type PageData,
  type ToolFactSheet,
} from "../schemas";

/** Ids a page's prose and verdicts may cite from the fact sheets. */
export function factSheetIds(sheets: readonly ToolFactSheet[]): Set<string> {
  const ids = new Set<string>();
  for (const sheet of sheets) {
    for (const tier of sheet.pricing.tiers) ids.add(tier.id);
    for (const metric of sheet.metrics) ids.add(metric.id);
    for (const point of [...sheet.strengths, ...sheet.weaknesses]) ids.add(point.id);
  }
  return ids;
}

function pageDataItems(data: PageData | LlmPageData): Array<{ id: string; evidenceRefs?: string[] }> {
  const items: Array<{ id: string; evidenceRefs?: string[] }> = [
    ...data.matrix,
    ...data.useCaseVerdicts,
    ...data.faqs,
  ];
  if ("costScenarios" in data) items.push(...data.costScenarios);
  if (data.pageType === "versus") items.push(...data.keyDifferences);
  if (data.pageType === "best_for") items.push(...data.criteria);
  if (data.pageType === "alternatives") items.push(...data.reasonsToSwitch);
  return items;
}

export function pageDataIds(data: PageData | LlmPageData): Set<string> {
  return new Set(pageDataItems(data).map((item) => item.id));
}

/**
 * Cross-field rules a JSON schema cannot state. An empty result means the payload is internally
 * consistent and every reference resolves; anything else is sent back to the model for repair.
 */
export function pageDataIssues(
  data: PageData | LlmPageData,
  expectedEntitySlugs: readonly string[],
  sheets: readonly ToolFactSheet[],
): string[] {
  const issues: string[] = [];
  const expected = new Set(expectedEntitySlugs);
  const covered = entitySlugsOf(data);

  for (const slug of covered) {
    if (!expected.has(slug)) issues.push(`entity "${slug}" is not one of this page's entities`);
  }
  if (new Set(covered).size !== covered.length) issues.push("an entity is listed more than once");
  if (data.pageType !== "best_for") {
    for (const slug of expected) {
      if (!covered.includes(slug)) issues.push(`entity "${slug}" is missing from the page`);
    }
  }

  const items = pageDataItems(data);
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) issues.push(`duplicate id "${item.id}"`);
    seen.add(item.id);
  }

  const resolvable = new Set([...seen, ...factSheetIds(sheets)]);
  const checkRefs = (owner: string, refs: readonly string[]) => {
    for (const ref of refs) {
      if (!resolvable.has(ref)) issues.push(`${owner}: evidenceRef "${ref}" does not resolve`);
    }
  };
  for (const item of items) if (item.evidenceRefs) checkRefs(item.id, item.evidenceRefs);

  for (const row of data.matrix) {
    const cellSlugs = row.cells.map((cell) => cell.entitySlug);
    for (const slug of covered) {
      if (!cellSlugs.includes(slug)) issues.push(`matrix row "${row.id}" has no cell for "${slug}"`);
    }
    if (row.winnerSlug !== null && !cellSlugs.includes(row.winnerSlug)) {
      issues.push(`matrix row "${row.id}": winner "${row.winnerSlug}" has no cell`);
    }
  }
  for (const verdict of data.useCaseVerdicts) {
    if (!covered.includes(verdict.pickSlug)) {
      issues.push(`verdict "${verdict.id}" picks "${verdict.pickSlug}", which is not on the page`);
    }
  }

  if (data.pageType === "versus" && data.bottomLine.overallPickSlug !== null) {
    if (!covered.includes(data.bottomLine.overallPickSlug)) issues.push("bottomLine picks an entity not on the page");
  }
  if (data.pageType === "best_for") {
    const ranks = data.ranked.map((item) => item.rank).sort((a, b) => a - b);
    if (ranks.some((rank, index) => rank !== index + 1)) issues.push("ranks must be 1..n without gaps");
    for (const item of data.ranked) {
      checkRefs(`ranked ${item.entitySlug}`, item.evidenceRefs);
      const sheet = sheets.find((candidate) => candidate.entitySlug === item.entitySlug);
      if (item.recommendedTierId && !sheet?.pricing.tiers.some((tier) => tier.id === item.recommendedTierId)) {
        issues.push(`ranked ${item.entitySlug}: tier "${item.recommendedTierId}" is not one of its tiers`);
      }
    }
  }
  if (data.pageType === "alternatives") {
    for (const alternative of data.alternatives) checkRefs(`alternative ${alternative.entitySlug}`, alternative.evidenceRefs);
  }
  return issues;
}

/** References in a draft that point at nothing, and FAQs left unanswered. */
export function draftReferenceProblems(
  draft: DraftContent,
  data: PageData,
  sheets: readonly ToolFactSheet[],
): { danglingRefs: string[]; missingFaqAnswers: string[] } {
  const resolvable = new Set([...pageDataIds(data), ...factSheetIds(sheets)]);
  const faqIds = new Set(data.faqs.map((faq) => faq.id));
  const answered = new Set(draft.faqAnswers.map((answer) => answer.faqId));

  const danglingRefs = new Set<string>();
  for (const block of draft.blocks) {
    for (const ref of block.dataRefs) if (!resolvable.has(ref)) danglingRefs.add(ref);
  }
  for (const id of answered) if (!faqIds.has(id)) danglingRefs.add(id);

  return {
    danglingRefs: [...danglingRefs],
    missingFaqAnswers: [...faqIds].filter((id) => !answered.has(id)),
  };
}
