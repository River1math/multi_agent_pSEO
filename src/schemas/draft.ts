import { z } from "zod";
import { RefIdSchema } from "./common";
import { QaIssueSchema } from "./qa";

/**
 * Copy the Drafting Agent writes. Tables, prices, verdict cards and FAQ questions are rendered
 * from structured data by the template, so the drafter cannot restate them wrongly; it writes the
 * prose around them and must declare which data each block interprets.
 */

export const CopyBlockSchema = z.object({
  id: RefIdSchema,
  kind: z.enum([
    "intro", // answers the query in the first two sentences
    "analysis", // interprets a group of matrix rows / a key difference
    "pricing_commentary", // interprets tiers and cost scenarios
    "verdict", // who should pick what, and when the answer flips
  ]),
  heading: z.string().max(70).nullable().describe("H2 text. Null only for the intro block."),
  bodyMarkdown: z
    .string()
    .min(120)
    .max(1400)
    .describe("Paragraphs, bold and bullet lists only. No tables, headings, links or HTML."),
  dataRefs: z
    .array(RefIdSchema)
    .min(1)
    .describe("Ids of the page-data / fact-sheet items this block's claims come from"),
});

export const DraftContentSchema = z.object({
  title: z.string().min(20).max(60).describe("<title>; must contain the primary keyword"),
  metaDescription: z.string().min(70).max(155),
  h1: z.string().min(10).max(80),
  keyTakeaways: z
    .array(z.string().max(180))
    .min(3)
    .max(5)
    .describe("Each bullet states one concrete fact or number from the data"),
  blocks: z.array(CopyBlockSchema).min(4).max(9),
  faqAnswers: z
    .array(z.object({ faqId: RefIdSchema, answerMarkdown: z.string().min(40).max(600) }))
    .describe("One entry per FAQ id in the page data"),
});

/** Present only on attempts 1..2; the drafter revises the flagged blocks, not the whole page. */
export const RevisionContextSchema = z.object({
  attempt: z.int().min(1).max(2),
  previousDraft: DraftContentSchema,
  previousScore: z.int().min(0).max(100),
  issues: z.array(QaIssueSchema).min(1),
});

export type CopyBlock = z.infer<typeof CopyBlockSchema>;
export type DraftContent = z.infer<typeof DraftContentSchema>;
export type RevisionContext = z.infer<typeof RevisionContextSchema>;
