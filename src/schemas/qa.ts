import { z } from "zod";
import { RefIdSchema, SlugSchema } from "./common";

export const RUBRIC_VERSION = 1;
export const QA_PASS_THRESHOLD = 85;
export const MAX_REVISIONS = 2;
/** A page cannot pass on a high total while one dimension is weak. */
export const DIMENSION_FLOOR = 70;

export const RUBRIC_WEIGHTS = {
  informationGain: 0.4,
  uniqueness: 0.3,
  factConsistency: 0.3,
} as const;

export const QaDimensionSchema = z.enum(["informationGain", "uniqueness", "factConsistency"]);

export const QaIssueSchema = z.object({
  dimension: QaDimensionSchema,
  severity: z.enum([
    "blocker", // fails the page regardless of score (e.g. a number that contradicts the data)
    "major",
    "minor",
  ]),
  blockId: RefIdSchema.nullable().describe("Copy block to revise; null for page-level issues"),
  quote: z.string().max(240).nullable().describe("Exact offending text"),
  problem: z.string().max(280),
  fixInstruction: z.string().max(280).describe("A concrete edit, naming the data to use"),
});

const DimensionScoreSchema = z.object({
  score: z.int().min(0).max(100),
  rationale: z.string().max(400),
});

/**
 * What the Gatekeeper model returns. It scores dimensions and lists issues; it does not compute
 * the total or the verdict — `scoreQa` does, so the pass rule cannot be argued around.
 */
export const LlmQaReportSchema = z.object({
  informationGain: DimensionScoreSchema.describe(
    "Specific, decision-relevant facts a reader could not get from either vendor's homepage. " +
      "Penalize filler, hedging and claims that would be true of any product.",
  ),
  uniqueness: DimensionScoreSchema.describe(
    "Structure and wording versus the supplied sibling excerpts. Penalize reused sentence frames, " +
      "identical block order with swapped names, and interchangeable verdicts.",
  ),
  factConsistency: DimensionScoreSchema.describe(
    "Every claim in the copy is supported by the structured data and nothing contradicts it.",
  ),
  issues: z.array(QaIssueSchema).max(12),
});

/** Measured in code before the Gatekeeper model runs, and passed to it as evidence. */
export const DeterministicSignalsSchema = z.object({
  wordCount: z.int().nonnegative(),
  /** Highest shingle Jaccard similarity of the prose against any sibling page (0–1). */
  maxSiblingSimilarity: z.number().min(0).max(1),
  nearestSiblingSlug: SlugSchema.nullable(),
  /** Numbers / prices in the copy that appear nowhere in the page data or fact sheets. */
  unsupportedNumbers: z.array(z.string()),
  /** dataRefs / faqIds that do not resolve. */
  danglingRefs: z.array(z.string()),
  missingFaqAnswers: z.array(z.string()),
  /** Stock phrases ("in today's fast-paced world", "it depends on your needs", …). */
  boilerplateHits: z.array(z.string()),
  titleCollision: z.boolean(),
});

export const QaResultSchema = z.object({
  rubricVersion: z.int(),
  total: z.int().min(0).max(100),
  dimensions: z.object({
    informationGain: z.int().min(0).max(100),
    uniqueness: z.int().min(0).max(100),
    factConsistency: z.int().min(0).max(100),
  }),
  verdict: z.enum(["pass", "revise", "human_review"]),
  issues: z.array(QaIssueSchema),
});

export type QaDimension = z.infer<typeof QaDimensionSchema>;
export type QaIssue = z.infer<typeof QaIssueSchema>;
export type LlmQaReport = z.infer<typeof LlmQaReportSchema>;
export type DeterministicSignals = z.infer<typeof DeterministicSignalsSchema>;
export type QaResult = z.infer<typeof QaResultSchema>;

/** Similarity at or below this costs nothing; at or above the ceiling the dimension scores 0. */
const SIMILARITY_FREE = 0.25;
const SIMILARITY_CEILING = 0.6;

function similarityCap(similarity: number): number {
  if (similarity <= SIMILARITY_FREE) return 100;
  if (similarity >= SIMILARITY_CEILING) return 0;
  return Math.round((100 * (SIMILARITY_CEILING - similarity)) / (SIMILARITY_CEILING - SIMILARITY_FREE));
}

/**
 * Combines the model's judgement with measured signals. Measured signals only ever lower a score:
 * the model can find problems code cannot, but it cannot overrule a measured duplicate or an
 * unsupported number.
 */
export function scoreQa(
  report: LlmQaReport,
  signals: DeterministicSignals,
  attempt: number,
): QaResult {
  const issues: QaIssue[] = [...report.issues];
  const codeBlocker = (dimension: QaDimension, problem: string, fixInstruction: string) =>
    issues.push({ dimension, severity: "blocker", blockId: null, quote: null, problem, fixInstruction });

  if (signals.unsupportedNumbers.length > 0) {
    codeBlocker(
      "factConsistency",
      `Numbers not found in the structured data: ${signals.unsupportedNumbers.join(", ")}`,
      "Replace each with the value from the cited data item, or remove the claim.",
    );
  }
  if (signals.danglingRefs.length > 0 || signals.missingFaqAnswers.length > 0) {
    codeBlocker(
      "factConsistency",
      `Unresolved references: ${[...signals.danglingRefs, ...signals.missingFaqAnswers].join(", ")}`,
      "Use only ids present in the page data and answer every FAQ id.",
    );
  }
  if (signals.titleCollision) {
    codeBlocker("uniqueness", "Title duplicates a sibling page.", "Write a title specific to this page.");
  }
  if (signals.maxSiblingSimilarity >= SIMILARITY_CEILING) {
    codeBlocker(
      "uniqueness",
      `Prose is ${Math.round(signals.maxSiblingSimilarity * 100)}% similar to ${signals.nearestSiblingSlug ?? "a sibling"}.`,
      "Restructure around this page's own key differences instead of the shared frame.",
    );
  }

  const factPenalty = signals.unsupportedNumbers.length > 0 || signals.danglingRefs.length > 0 ? 60 : 100;
  const dimensions = {
    informationGain: Math.max(0, report.informationGain.score - 5 * signals.boilerplateHits.length),
    uniqueness: Math.min(report.uniqueness.score, similarityCap(signals.maxSiblingSimilarity)),
    factConsistency: Math.min(report.factConsistency.score, factPenalty),
  };

  const total = Math.round(
    dimensions.informationGain * RUBRIC_WEIGHTS.informationGain +
      dimensions.uniqueness * RUBRIC_WEIGHTS.uniqueness +
      dimensions.factConsistency * RUBRIC_WEIGHTS.factConsistency,
  );

  const passed =
    total >= QA_PASS_THRESHOLD &&
    Object.values(dimensions).every((score) => score >= DIMENSION_FLOOR) &&
    !issues.some((issue) => issue.severity === "blocker");

  const verdict = passed ? "pass" : attempt < MAX_REVISIONS ? "revise" : "human_review";

  return { rubricVersion: RUBRIC_VERSION, total, dimensions, verdict, issues };
}
