import { comparisonTokens, containment, draftProse, shingles, stripMarkdown } from "../../qa/text";
import type { GatekeeperInput, LlmQaReport, QaIssue } from "../../schemas";
import { clip } from "./simulate-page-data";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter((part) => part.length > 20);

/**
 * A rule-based stand-in for the Gatekeeper model. It reads the same input the real one gets and
 * derives its scores from the draft's content and the measured signals, so its verdicts respond
 * to what the Drafting Agent actually wrote rather than being scripted per page.
 */
export function simulateReview(input: GatekeeperInput): LlmQaReport {
  const { draft, signals } = input;
  const issues: QaIssue[] = [];
  const names = [...input.factSheets.map((sheet) => sheet.name), ...input.siblings.flatMap((sibling) => sibling.entityNames)];
  const nearest = input.siblings.find((sibling) => sibling.slug === signals.nearestSiblingSlug) ?? input.siblings[0];
  const siblingShingles = nearest ? shingles(comparisonTokens(nearest.prose, names)) : null;

  // Fact consistency: each unsupported number is traced to the block and sentence that states it.
  for (const raw of signals.unsupportedNumbers) {
    const block = draft.blocks.find((candidate) => candidate.bodyMarkdown.includes(raw));
    const quote = sentencesOf(stripMarkdown(block?.bodyMarkdown ?? "")).find((part) => part.includes(raw)) ?? null;
    issues.push({
      dimension: "factConsistency",
      severity: "blocker",
      blockId: block?.id ?? null,
      quote: quote ? clip(quote, 240) : null,
      problem: `"${raw}" does not appear in the page data or any fact sheet.`,
      fixInstruction: "Remove the claim, or restate it with a figure from the matrix or the cost scenarios.",
    });
  }
  if (signals.missingFaqAnswers.length > 0) {
    issues.push({
      dimension: "factConsistency",
      severity: "major",
      blockId: null,
      quote: null,
      problem: `No answer written for FAQ: ${signals.missingFaqAnswers.join(", ")}.`,
      fixInstruction: "Add a faqAnswers entry for each listed id, based on that FAQ's answer in the page data.",
    });
  }
  const factConsistency = clamp(96 - 18 * signals.unsupportedNumbers.length - 12 * (signals.danglingRefs.length + signals.missingFaqAnswers.length), 30, 96);

  // Uniqueness: blocks whose text is largely contained in the nearest sibling.
  let copiedBlocks = 0;
  if (siblingShingles && nearest) {
    for (const block of draft.blocks) {
      const share = containment(shingles(comparisonTokens(stripMarkdown(block.bodyMarkdown), names)), siblingShingles);
      if (share < 0.5) continue;
      copiedBlocks++;
      issues.push({
        dimension: "uniqueness",
        severity: share >= 0.8 ? "blocker" : "major",
        blockId: block.id,
        quote: clip(sentencesOf(stripMarkdown(block.bodyMarkdown))[0] ?? "", 240) || null,
        problem: `${Math.round(share * 100)}% of this block's wording also appears on ${nearest.slug} once product names are masked.`,
        fixInstruction: "Rewrite the block from this page's own key differences and matrix rows instead of the sibling's sentences.",
      });
    }
  }
  const uniqueness = clamp(97 - 110 * Math.max(0, signals.maxSiblingSimilarity - 0.2) - 4 * copiedBlocks, 20, 97);

  // Information gain: the share of sentences that state a concrete figure.
  const sentences = sentencesOf(draftProse(draft));
  const specific = sentences.filter((part) => /\d/.test(part)).length / Math.max(1, sentences.length);
  const informationGain = clamp(55 + 42 * Math.min(1, specific / 0.45), 0, 97);
  for (const phrase of signals.boilerplateHits) {
    const block = draft.blocks.find((candidate) => candidate.bodyMarkdown.toLowerCase().includes(phrase));
    const quote = sentencesOf(stripMarkdown(block?.bodyMarkdown ?? "")).find((part) => part.toLowerCase().includes(phrase)) ?? null;
    issues.push({
      dimension: "informationGain",
      severity: "minor",
      blockId: block?.id ?? null,
      quote: quote ? clip(quote, 240) : null,
      problem: `Stock phrase "${phrase}" tells the reader nothing about these products.`,
      fixInstruction: "Delete the sentence and open with the first concrete difference.",
    });
  }
  if (informationGain < 85) {
    issues.push({
      dimension: "informationGain",
      severity: "major",
      blockId: null,
      quote: null,
      problem: `Only ${Math.round(specific * 100)}% of sentences state a concrete figure; the rest would be true of any two products.`,
      fixInstruction: "Replace general statements with the specific limits and prices from the matrix.",
    });
  }

  return {
    informationGain: { score: informationGain, rationale: `${Math.round(specific * 100)}% of ${sentences.length} sentences carry a concrete figure; ${signals.boilerplateHits.length} stock phrase(s).` },
    uniqueness: { score: uniqueness, rationale: nearest ? `Measured similarity ${signals.maxSiblingSimilarity.toFixed(2)} to ${nearest.slug}; ${copiedBlocks} block(s) substantially shared.` : "No approved sibling page to compare against yet." },
    factConsistency: { score: factConsistency, rationale: `${signals.unsupportedNumbers.length} unsupported number(s), ${signals.danglingRefs.length} dangling reference(s), ${signals.missingFaqAnswers.length} unanswered FAQ(s).` },
    issues: issues.slice(0, 12),
  };
}
