import type { LlmGateway } from "../llm/gateway";
import {
  GatekeeperInputSchema,
  LlmQaReportSchema,
  scoreQa,
  type GatekeeperInput,
  type LlmQaReport,
  type QaResult,
} from "../schemas";
import { payload } from "./render";

const REVIEW_SYSTEM = `You are the quality gate for a programmatic SEO site. Pages you pass are published without human review, so your job is to stop thin, duplicated or inaccurate pages — the kind that get a whole site demoted — while letting specific, useful ones through.

You receive a draft, the structured data it must be faithful to, measured signals, and the nearest already-published sibling pages. Score three dimensions from 0 to 100:

1. informationGain — does the copy tell a reader things that change their decision and that they could not get from a vendor homepage? Reward exact limits, prices in context, and stated conditions under which the recommendation flips. Penalize filler, hedging, and sentences that would be true of any two products.
2. uniqueness — compared with the sibling pages, is this page's structure and wording its own? Penalize shared sentence frames, the same block order with names swapped, and verdicts that could be moved to a sibling unchanged. The measured similarity is a floor on how bad this is, not the whole picture: pages can be templated without sharing exact wording.
3. factConsistency — is every claim in the copy supported by the structured data, with nothing contradicting it? Check product-to-fact attribution, not only that numbers exist somewhere in the data.

Calibration: 85 or above means you would publish it as is. 70–84 means it is fixable with targeted edits. Below 70 means the dimension fails. Score what is on the page; do not reward a draft for effort or length.

For every problem, write an issue the writer can act on without seeing your reasoning: the block, the exact quote, what is wrong, and a concrete fix that names the data item to use. Mark an issue "blocker" when publishing it would be harmful by itself — a wrong price, a fact attributed to the wrong product, a page that is substantially a copy of a sibling.

The measured signals are facts, not opinions; do not contradict them. You do not decide pass or fail: a fixed rule combines your scores with the measured signals.`;

/**
 * Quality Gatekeeper: the model scores and critiques; `scoreQa` turns that plus the measured
 * signals into the total and the verdict.
 */
export async function reviewDraft(
  llm: LlmGateway,
  rawInput: GatekeeperInput,
  pageId: string | null,
): Promise<{ report: LlmQaReport; result: QaResult; model: string }> {
  const input = GatekeeperInputSchema.parse(rawInput);
  const blockIds = new Set(input.draft.blocks.map((block) => block.id));

  const review = await llm.generate({
    task: "gatekeeper.review",
    schema: LlmQaReportSchema,
    system: REVIEW_SYSTEM,
    prompt: [
      payload("query", input.keywordPhrase),
      payload("draft", input.draft),
      payload("page_data", input.pageData),
      payload("fact_sheets", input.factSheets),
      payload("measured_signals", input.signals),
      payload("sibling_pages", input.siblings),
    ].join("\n\n"),
    input,
    pageId,
    validate: (report) =>
      report.issues
        .filter((issue) => issue.blockId !== null && !blockIds.has(issue.blockId))
        .map((issue) => `issue references unknown blockId "${issue.blockId}"`),
  });

  return {
    report: review.data,
    result: scoreQa(review.data, input.signals, input.attempt),
    model: review.model,
  };
}
