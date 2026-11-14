/**
 * Verifies that every schema an agent sends to Claude as a structured-output format converts
 * cleanly, and prints its wire size. Run after any schema change: `npm run schemas:check`.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  DraftContentSchema,
  KeywordDedupSchema,
  KeywordExpansionSchema,
  llmPageDataSchemaFor,
  LlmQaReportSchema,
  ToolFactSheetSchema,
} from "../src/schemas";

const llmFacing: Record<string, z.ZodType> = {
  "keyword.expansion": KeywordExpansionSchema,
  "keyword.dedup": KeywordDedupSchema,
  "extractor.factSheet": ToolFactSheetSchema,
  "extractor.pageData.versus": llmPageDataSchemaFor.versus,
  "extractor.pageData.best_for": llmPageDataSchemaFor.best_for,
  "extractor.pageData.alternatives": llmPageDataSchemaFor.alternatives,
  "drafter.content": DraftContentSchema,
  "gatekeeper.report": LlmQaReportSchema,
};

let failed = false;
for (const [name, schema] of Object.entries(llmFacing)) {
  try {
    const format = zodOutputFormat(schema);
    const bytes = JSON.stringify(format.schema).length;
    console.log(`ok    ${name.padEnd(34)} ${String(bytes).padStart(6)} bytes`);
  } catch (error) {
    failed = true;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failed ? 1 : 0);
