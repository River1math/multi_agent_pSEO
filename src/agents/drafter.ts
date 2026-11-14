import type { LlmGateway } from "../llm/gateway";
import { DraftContentSchema, DrafterInputSchema, type DraftContent, type DrafterInput } from "../schemas";
import { payload } from "./render";

const DRAFT_SYSTEM = `You write the prose for one page of a software comparison site. The page's tables, prices, verdict cards and FAQ questions are rendered directly from structured data; your copy sits between them and has one job: tell the reader what the data means for their decision.

How the page is judged, and therefore how to write it:
- Information gain. Every paragraph should state something specific a reader could not get from either vendor's homepage: a limit, a price difference, the condition under which the recommendation flips. Cut any sentence that would be equally true of two other products.
- Fact consistency. Use only numbers and claims present in page_data and fact_sheets, written exactly as they appear there. Do not derive new numbers (differences, percentages, annual totals) — an automated check rejects any number it cannot find in the data. List in dataRefs the ids of the items each block relies on.
- Uniqueness. sibling_pages are already published. Do not reuse their headings, openings or sentence frames; organise this page around what is distinctive about this comparison.

Format: the intro answers the query in its first two sentences. Block bodies are paragraphs, bold and bullet lists only — no tables, headings, links or HTML. Write one faqAnswers entry for every FAQ id in page_data. Keep the title within 60 characters and include the query's main terms.

When a revision block is present, the previous draft was rejected. Fix exactly the issues listed, following each fixInstruction, and return the complete draft. Keep blocks that were not flagged as they are, so the fix does not introduce new problems.`;

/** Drafting Agent: structured data → copy blocks; on later attempts, a critique-driven revision. */
export async function draftPage(
  llm: LlmGateway,
  rawInput: DrafterInput,
  pageId: string | null,
): Promise<{ draft: DraftContent; model: string }> {
  const input = DrafterInputSchema.parse(rawInput);
  const attempt = input.revision?.attempt ?? 0;

  const result = await llm.generate({
    task: attempt === 0 ? "drafter.draft" : "drafter.revise",
    attempt,
    schema: DraftContentSchema,
    system: DRAFT_SYSTEM,
    prompt: [
      payload("query", input.keywordPhrase),
      payload("page_data", input.pageData),
      payload("fact_sheets", input.factSheets),
      payload("sibling_pages", input.siblings.map(({ slug, title, headings }) => ({ slug, title, headings }))),
      ...(input.revision ? [payload("revision", input.revision)] : []),
    ].join("\n\n"),
    input,
    pageId,
    validate: (draft) => {
      const ids = draft.blocks.map((block) => block.id);
      return new Set(ids).size === ids.length ? [] : ["block ids must be unique"];
    },
  });
  return { draft: result.data, model: result.model };
}
