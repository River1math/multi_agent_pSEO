import { COPIED_BLOCK_SHARE, type DeterministicSignals, type DraftContent, type PageData, type ToolFactSheet } from "../schemas";
import { draftReferenceProblems } from "./integrity";
import { comparisonTokens, containment, draftProse, jaccard, numbersIn, shingles, stripMarkdown, wordCount } from "./text";

/** Stock phrases that carry no information. Each hit costs information-gain points. */
const BOILERPLATE = [
  "in today's fast-paced",
  "in the ever-evolving",
  "in the world of",
  "when it comes to",
  "it depends on your needs",
  "look no further",
  "game-changer",
  "at the end of the day",
  "in conclusion",
  "unlock the power",
  "to the next level",
  "both are solid options",
  "both tools offer",
  "there is no one-size-fits-all",
];

export interface SiblingDocument {
  slug: string;
  title: string;
  prose: string;
}

/** Every number present anywhere in the structured data: the only numbers prose may state. */
function supportedNumbers(...sources: unknown[]): Set<string> {
  const supported = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "number") supported.add(String(value));
    else if (typeof value === "string") for (const found of numbersIn(value)) supported.add(found.value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  sources.forEach(visit);
  return supported;
}

/** Siblings ordered from most to least similar to `prose` (shingle Jaccard, product names masked). */
export function rankBySimilarity<T extends { prose: string }>(
  prose: string,
  siblings: readonly T[],
  entityNames: readonly string[],
): Array<{ sibling: T; similarity: number }> {
  const own = shingles(comparisonTokens(prose, entityNames));
  return siblings
    .map((sibling) => ({ sibling, similarity: jaccard(own, shingles(comparisonTokens(sibling.prose, entityNames))) }))
    .sort((a, b) => b.similarity - a.similarity);
}

export interface SignalInput {
  draft: DraftContent;
  pageData: PageData;
  factSheets: readonly ToolFactSheet[];
  siblings: readonly SiblingDocument[];
  /** Names and aliases of every entity in the vertical, masked before comparing text. */
  entityNames: readonly string[];
}

export function computeSignals(input: SignalInput): DeterministicSignals {
  const prose = draftProse(input.draft);
  const lower = prose.toLowerCase();

  const supported = supportedNumbers(input.pageData, input.factSheets);
  const unsupported = new Set<string>();
  for (const found of numbersIn(prose)) {
    // Small bare counts ("3 plans", list markers) are not factual claims worth blocking on.
    const trivial = !found.marked && Number(found.value) <= 10;
    if (!trivial && !supported.has(found.value)) unsupported.add(found.raw);
  }

  const nearest = rankBySimilarity(prose, input.siblings, input.entityNames)[0];
  const maxSiblingSimilarity = nearest?.similarity ?? 0;
  const nearestSiblingSlug = nearest && nearest.similarity > 0 ? nearest.sibling.slug : null;

  const siblingShingles = input.siblings.map((sibling) => ({
    slug: sibling.slug,
    set: shingles(comparisonTokens(sibling.prose, input.entityNames)),
  }));
  const copiedBlocks = input.draft.blocks.flatMap((block) => {
    const own = shingles(comparisonTokens(stripMarkdown(block.bodyMarkdown), input.entityNames));
    const closest = siblingShingles
      .map((sibling) => ({ siblingSlug: sibling.slug, share: containment(own, sibling.set) }))
      .sort((a, b) => b.share - a.share)[0];
    return closest && closest.share >= COPIED_BLOCK_SHARE
      ? [{ blockId: block.id, siblingSlug: closest.siblingSlug, share: Math.round(closest.share * 100) / 100 }]
      : [];
  });

  const title = input.draft.title.trim().toLowerCase();
  return {
    wordCount: wordCount(prose),
    maxSiblingSimilarity: Math.round(maxSiblingSimilarity * 1000) / 1000,
    nearestSiblingSlug,
    copiedBlocks,
    unsupportedNumbers: [...unsupported],
    ...draftReferenceProblems(input.draft, input.pageData, input.factSheets),
    boilerplateHits: BOILERPLATE.filter((phrase) => lower.includes(phrase)),
    titleCollision: input.siblings.some((sibling) => sibling.title.trim().toLowerCase() === title),
  };
}
