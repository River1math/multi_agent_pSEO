import type { CopyBlock, DraftContent, DrafterInput, PageData, ToolFactSheet } from "../../schemas";
import { clip, entryTier } from "./simulate-page-data";

/**
 * How the simulated Drafting Agent behaves for a page. The first is a competent writer; the other
 * two reproduce the failure modes the Quality Gatekeeper exists to stop.
 */
export type DraftScenario =
  | "clean"
  /** First draft pads the intro, invents two numbers and skips an FAQ; it fixes what is flagged. */
  | "flawed_first_draft"
  /** Reuses an approved sibling's copy with the product names swapped, and barely revises. */
  | "spun_from_sibling";

const nameOf = (sheets: readonly ToolFactSheet[], slug: string) => sheets.find((sheet) => sheet.entitySlug === slug)?.name ?? slug;
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

function analysisBlocks(data: PageData, sheets: readonly ToolFactSheet[]): CopyBlock[] {
  const why = (rowId: string | undefined) => data.matrix.find((row) => row.id === rowId)?.whyItMatters ?? "";
  if (data.pageType === "versus") {
    return data.keyDifferences.slice(0, 4).map((difference) => ({
      id: `analysis-${difference.id}`,
      kind: "analysis",
      heading: clip(difference.headline, 70),
      bodyMarkdown: clip(`${sentence(difference.detail)} ${why(difference.evidenceRefs[0])}`, 1400),
      dataRefs: difference.evidenceRefs,
    }));
  }
  if (data.pageType === "best_for") {
    return data.ranked.slice(0, 4).map((item) => ({
      id: `analysis-${item.entitySlug}`,
      kind: "analysis",
      heading: clip(`${item.rank}. ${nameOf(sheets, item.entitySlug)}: fit score ${item.fitScore}`, 70),
      bodyMarkdown: clip(`${sentence(item.whyItFits)} **Best for:** ${sentence(item.bestForSubsegment)} **The tradeoff:** ${sentence(item.tradeoff)}`, 1400),
      dataRefs: item.evidenceRefs,
    }));
  }
  return data.alternatives.slice(0, 4).map((alternative) => ({
    id: `analysis-${alternative.entitySlug}`,
    kind: "analysis",
    heading: clip(`${nameOf(sheets, alternative.entitySlug)} instead of ${nameOf(sheets, data.subjectSlug)}`, 70),
    bodyMarkdown: clip(`**Choose it if:** ${sentence(alternative.chooseIf)} It is ahead on ${alternative.betterThanSubject.join(", ").toLowerCase()}, and behind on ${alternative.worseThanSubject.join(", ").toLowerCase()}. Migration effort is ${alternative.migrationEffort}.`, 1400),
    dataRefs: alternative.evidenceRefs,
  }));
}

/** A faithful draft: every sentence is assembled from the page data, so nothing can be unsupported. */
export function composeDraft(input: DrafterInput): DraftContent {
  const { pageData: data, factSheets: sheets } = input;
  const price = (slug: string) => {
    const sheet = sheets.find((candidate) => candidate.entitySlug === slug);
    const tier = sheet ? entryTier(sheet) : null;
    return tier ? `$${tier.priceUsdMonthly}/mo (${tier.name})` : "custom pricing";
  };
  const slugs = data.pageType === "versus" ? data.entitySlugs : data.pageType === "best_for" ? data.ranked.map((item) => item.entitySlug) : [data.subjectSlug, ...data.alternatives.map((alternative) => alternative.entitySlug)];
  const names = slugs.map((slug) => nameOf(sheets, slug));
  const priceLine = slugs.map((slug) => `${nameOf(sheets, slug)} ${price(slug)}`).join(", ");

  let title: string;
  let h1: string;
  let opening: string;
  if (data.pageType === "versus") {
    title = `${names[0]} vs ${names[1]}: Pricing and Features Compared`;
    h1 = `${names[0]} vs ${names[1]}: which one fits how you work?`;
    opening = `${sentence(data.bottomLine.summary)} Paid plans start at ${priceLine}.`;
  } else if (data.pageType === "best_for") {
    const top = data.ranked[0];
    title = `Best AI Code Editor for ${data.niche.label.replace(/\b\w/g, (letter) => letter.toUpperCase())} (Ranked)`;
    h1 = `The best AI code editor for ${data.niche.label}`;
    opening = `For ${data.niche.label}, ${nameOf(sheets, top?.entitySlug ?? "")} ranks first. ${sentence(top?.whyItFits ?? "")} The ranking weighs ${data.criteria.map((criterion) => criterion.criterion.toLowerCase()).join(", ")}, because ${data.niche.constraints[0]?.toLowerCase()}.`;
  } else {
    title = `${names[0]} Alternatives: ${names.slice(1, 4).join(", ")}`;
    h1 = `${names[0]} alternatives, and when each one is the better choice`;
    opening = `The usual reasons to leave ${names[0]}: ${data.reasonsToSwitch.map((reason) => reason.headline.toLowerCase()).join("; ")}. Paid plans for the alternatives start at ${priceLine}.`;
  }

  const blocks: CopyBlock[] = [
    { id: "intro", kind: "intro", heading: null, bodyMarkdown: clip(opening, 1400), dataRefs: ["row-entry-price"] },
    ...analysisBlocks(data, sheets),
    {
      id: "pricing",
      kind: "pricing_commentary",
      heading: "What you would actually pay",
      bodyMarkdown: clip(
        data.costScenarios
          .map((scenario) => `**${scenario.label}:** ${scenario.costs.map((cost) => `${nameOf(sheets, cost.entitySlug)} ${cost.monthlyUsd === null ? "has no self-serve price" : `$${cost.monthlyUsd}/mo on the ${cost.note}`}`).join("; ")}.`)
          .join("\n\n") + `\n\n${sheets.slice(0, 2).map((sheet) => `${sheet.name}: ${sheet.pricing.caveats[0] ?? ""}`).join(" ")}`,
        1400,
      ),
      dataRefs: data.costScenarios.map((scenario) => scenario.id),
    },
    {
      id: "verdict",
      kind: "verdict",
      heading: "Which one to pick",
      bodyMarkdown: clip(data.useCaseVerdicts.map((verdict) => `- **${verdict.useCase}:** ${nameOf(sheets, verdict.pickSlug)}. ${sentence(verdict.reasoning)}${verdict.caveat ? ` ${sentence(verdict.caveat)}` : ""}`).join("\n"), 1400),
      dataRefs: data.useCaseVerdicts.map((verdict) => verdict.id),
    },
  ];

  const freeRow = data.matrix.find((row) => row.id === "row-free-tier");
  return {
    title: clip(title, 60),
    metaDescription: clip(`${names.slice(0, 3).join(", ")} compared on price, agent features and IDE support. Paid plans start at ${priceLine}.`, 155),
    h1: clip(h1, 80),
    keyTakeaways: [
      clip(`Paid plans start at ${priceLine}.`, 180),
      clip(`Free plans: ${freeRow?.cells.map((cell) => `${nameOf(sheets, cell.entitySlug)} — ${cell.display}`).join("; ")}.`, 180),
      clip(sentence(data.useCaseVerdicts[0]?.reasoning ?? opening), 180),
    ],
    blocks,
    faqAnswers: data.faqs.map((faq) => ({ faqId: faq.id, answerMarkdown: clip(faq.answer, 600) })),
  };
}

function flawedDraft(input: DrafterInput): DraftContent {
  const draft = composeDraft(input);
  return {
    ...draft,
    blocks: draft.blocks.map((block) => {
      if (block.id === "intro") return { ...block, bodyMarkdown: clip(`In today's fast-paced world of software development, choosing the right tool can feel overwhelming. ${block.bodyMarkdown}`, 1400) };
      if (block.id === "pricing") return { ...block, bodyMarkdown: clip(`${block.bodyMarkdown} Most developers save around 37% by switching, with plans starting at just $7 per month.`, 1400) };
      return block;
    }),
    faqAnswers: draft.faqAnswers.slice(0, -1),
  };
}

/** Rebuilds only what the critique flagged, leaving every other block exactly as it was. */
function reviseFlagged(input: DrafterInput): DraftContent {
  const revision = input.revision;
  if (!revision) return composeDraft(input);
  const clean = composeDraft(input);
  const flagged = new Set(revision.issues.flatMap((issue) => issue.blockId ?? []));
  const pageLevel = revision.issues.some((issue) => issue.blockId === null);
  return {
    ...revision.previousDraft,
    blocks: revision.previousDraft.blocks.map((block) => (flagged.has(block.id) ? (clean.blocks.find((candidate) => candidate.id === block.id) ?? block) : block)),
    ...(pageLevel ? { faqAnswers: clean.faqAnswers, keyTakeaways: clean.keyTakeaways } : {}),
  };
}

function spunDraft(input: DrafterInput): DraftContent {
  const clean = composeDraft(input);
  const sibling = input.siblings[0];
  const ownNames = input.factSheets.map((sheet) => sheet.name);
  const attempt = input.revision?.attempt ?? 0;
  const vague = "It depends on your needs and budget; both are solid options for most development teams.";
  const firstRow = input.pageData.matrix[0]?.id ?? "row-entry-price";

  // The names that differ between the two pages are swapped; everything else is copied as is.
  const theirs = sibling?.entityNames.filter((name) => !ownNames.includes(name)) ?? [];
  const ours = ownNames.filter((name) => !sibling?.entityNames.includes(name));
  const swap = (text: string) => theirs.reduce((result, name, index) => result.replaceAll(name, ours[index] ?? ours[0] ?? name), text);

  const paragraphs = (sibling?.prose.split("\n\n") ?? []).filter((paragraph) => paragraph.length >= 120).slice(0, 6);
  while (paragraphs.length < 4) {
    paragraphs.push("Both tools offer a strong set of AI coding features, and the right choice depends on your needs. Each has its own strengths, so consider how you work, what your team prefers, and what you plan to spend.");
  }
  const kinds: CopyBlock["kind"][] = ["intro", "analysis", "analysis", "analysis", "pricing_commentary", "verdict"];
  const blocks: CopyBlock[] = paragraphs.map((paragraph, index) => ({
    id: index === 0 ? "intro" : `section-${index}`,
    kind: kinds[index] ?? "analysis",
    heading: index === 0 ? null : clip(swap(sibling?.headings[index - 1] ?? "What to consider"), 70),
    bodyMarkdown: clip(swap(paragraph), 1400),
    dataRefs: [firstRow],
  }));

  // Revisions touch one block each and leave the copied body of the page in place.
  const cleanIntro = clean.blocks.find((block) => block.id === "intro");
  if (attempt >= 1 && cleanIntro) blocks[0] = cleanIntro;
  const cleanVerdict = clean.blocks.find((block) => block.id === "verdict");
  if (attempt >= 2 && cleanVerdict) blocks[blocks.length - 1] = cleanVerdict;

  return {
    title: clip(sibling ? swap(sibling.title) : clean.title, 60),
    metaDescription: clean.metaDescription,
    h1: clean.h1,
    keyTakeaways: [
      "Both tools offer AI-assisted coding features for modern development teams.",
      "Pricing varies by plan, so compare the tiers before you commit.",
      "The best choice comes down to your workflow and preferences.",
    ],
    blocks,
    faqAnswers: input.pageData.faqs.map((faq) => ({ faqId: faq.id, answerMarkdown: vague })),
  };
}

export function simulateDraft(input: DrafterInput, scenario: DraftScenario): DraftContent {
  if (scenario === "spun_from_sibling") return spunDraft(input);
  if (input.revision) return reviseFlagged(input);
  return scenario === "flawed_first_draft" ? flawedDraft(input) : composeDraft(input);
}
