/**
 * End-to-end dry run: seed topic → keyword queue → 3 pages through extract, draft, QA and the
 * revision loop. Each run gets its own new SQLite file under prisma/dry-run/, so runs are
 * reproducible and earlier ones stay available for inspection.
 *
 *   npm run dry-run                    simulated models and sources (default)
 *   npm run dry-run -- --live          real Claude calls and web_fetch (needs API credentials)
 *   npm run dry-run -- --concurrency 3 --pages 3 --topic "AI code editors"
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDb } from "../src/db/client";
import { consoleLogger } from "../src/lib/log";
import { AnthropicTransport } from "../src/llm/anthropic-transport";
import { LlmGateway, type CallRecord } from "../src/llm/gateway";
import { MockSourceFetcher } from "../src/llm/mock/fixtures";
import { MockTransport } from "../src/llm/mock/transport";
import type { PipelineDeps } from "../src/pipeline/context";
import { enqueuePages, expandSeedTopic } from "../src/pipeline/keywords";
import { runWorker } from "../src/pipeline/orchestrator";
import { seedVertical } from "../src/pipeline/seed";
import { QA_PASS_THRESHOLD } from "../src/schemas";
import { ClaudeWebFetchSource } from "../src/sources/claude-web-fetch";
import { aiDevTools } from "../src/verticals/ai-dev-tools";

const { values: flags } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    concurrency: { type: "string", default: "1" },
    pages: { type: "string", default: "3" },
    topic: { type: "string", default: "AI code editors" },
  },
});

const DB_DIR = "prisma/dry-run";
const heading = (text: string) => console.log(`\n━━ ${text} ${"━".repeat(Math.max(0, 96 - text.length))}`);
const usd = (value: number) => `$${value.toFixed(4)}`;

async function main() {
  const live = flags.live;
  const concurrency = Number(flags.concurrency);
  const dbFile = `${DB_DIR}/run-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const dbUrl = `file:./${dbFile}`;

  console.log(`pSEO pipeline dry run — models: ${live ? "LIVE (Anthropic API)" : "SIMULATED (mock transport)"}, database: ${dbFile}`);
  if (!live) {
    console.log("Model outputs and product facts below are simulated fixtures. Routing, validation, retries,");
    console.log("measured QA signals, scoring and the revision loop are the real pipeline code.");
  }

  mkdirSync(DB_DIR, { recursive: true });
  execFileSync("npx", ["prisma", "db", "push"], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });

  const db = createDb(dbUrl);
  const log = consoleLogger();
  const run = await db.pipelineRun.create({ data: { dryRun: true } });
  const calls: CallRecord[] = [];

  const transport = live
    ? new AnthropicTransport()
    : new MockTransport({
        scenarios: {
          "best-ai-code-editor-for-solo-founders": "flawed_first_draft",
          "cursor-vs-windsurf": "spun_from_sibling",
        },
        rateLimitOnceOn: "extractor.factSheet",
        invalidOutputOnceOn: "drafter.draft",
      });
  const llm = new LlmGateway({
    transport,
    log,
    concurrency: 4,
    onCall: async (record) => {
      calls.push(record);
      const { task: _task, tier: _tier, ...row } = record;
      await db.agentCall.create({ data: { ...row, runId: run.id } });
      const tokens = `${record.inputTokens}+${record.cacheReadTokens + record.cacheWriteTokens} in / ${record.outputTokens} out`;
      log.info(`llm ${record.task}`, `${record.agent} → ${record.model} [${record.tier}] ${tokens} ${usd(record.costUsd)}${record.error ? ` ✘ ${record.error}` : ""}`);
    },
  });
  const deps: PipelineDeps = {
    db,
    llm,
    sources: live ? new ClaudeWebFetchSource() : new MockSourceFetcher(),
    vertical: aiDevTools,
    log,
    workerId: `dry-run-${process.pid}`,
  };

  heading("1. Keyword & SERP Intent Agent");
  const verticalId = await seedVertical(deps);
  const keywords = await expandSeedTopic(deps, verticalId, flags.topic);
  console.log(`\nSeed topic "${flags.topic}" → ${keywords.queued.length} queued, ${keywords.duplicates.length} duplicate, ${keywords.skipped.length} skipped`);
  for (const keyword of keywords.queued) {
    console.log(`  queued     ${keyword.priority.toFixed(1).padStart(5)}  ${keyword.phrase.padEnd(40)} ${keyword.pageType.padEnd(13)} ${keyword.intent.padEnd(11)} ${keyword.canonicalKey}`);
  }
  for (const duplicate of keywords.duplicates) {
    console.log(`  duplicate         ${duplicate.candidate.phrase.padEnd(40)} of ${duplicate.duplicateOfKey} (${duplicate.detectedBy === "model" ? "model dedup pass" : "canonical key"})`);
  }
  for (const skipped of keywords.skipped) console.log(`  skipped           ${skipped.phrase.padEnd(40)} ${skipped.reason}`);

  heading(`2. Orchestrator: top ${flags.pages} keywords → Extractor → Drafter → Gatekeeper (page concurrency ${concurrency})`);
  await enqueuePages(deps, verticalId, Number(flags.pages));
  await runWorker(deps, { concurrency });

  heading("3. Results");
  const pages = await db.page.findMany({
    orderBy: { keyword: { priority: "desc" } },
    include: { keyword: true, drafts: { orderBy: { attempt: "asc" }, include: { evaluation: true } } },
  });
  console.log(`\n  ${"page".padEnd(40)} ${"status".padEnd(19)} score  per-attempt QA: total (info-gain/uniqueness/fact-consistency) verdict`);
  for (const page of pages) {
    const attempts = page.drafts
      .map((draft) => {
        const evaluation = draft.evaluation;
        return evaluation ? `#${draft.attempt} ${evaluation.totalScore} (${evaluation.informationGain}/${evaluation.uniqueness}/${evaluation.factConsistency}) ${evaluation.verdict}` : `#${draft.attempt} not evaluated`;
      })
      .join("  →  ");
    console.log(`  ${page.slug.padEnd(40)} ${page.status.padEnd(19)} ${String(page.qaScore ?? "—").padStart(5)}  ${attempts}${page.lastError ? `  error: ${page.lastError}` : ""}`);
  }

  const byModel = new Map<string, { calls: number; input: number; output: number; cost: number }>();
  for (const call of calls) {
    const key = `${call.agent.padEnd(11)} ${call.model}`;
    const entry = byModel.get(key) ?? { calls: 0, input: 0, output: 0, cost: 0 };
    entry.calls++;
    entry.input += call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens;
    entry.output += call.outputTokens;
    entry.cost += call.costUsd;
    byModel.set(key, entry);
  }
  console.log(`\n  Model routing and cost${live ? "" : " (token counts estimated from simulated payloads)"}:`);
  for (const [key, entry] of [...byModel].sort()) {
    console.log(`  ${key.padEnd(32)} ${String(entry.calls).padStart(3)} calls  ${String(entry.input).padStart(7)} in  ${String(entry.output).padStart(6)} out  ${usd(entry.cost)}`);
  }
  console.log(`  ${"total".padEnd(32)} ${String(calls.length).padStart(3)} calls  ${"".padStart(22)}  ${usd(calls.reduce((sum, call) => sum + call.costUsd, 0))}`);

  heading("4. Idempotency check: re-run on the same database");
  const count = async () => ({
    keywords: await db.keyword.count(),
    drafts: await db.draft.count(),
    evaluations: await db.qaEvaluation.count(),
    sheets: await db.entityFactSheet.count(),
  });
  const before = await count();
  const callsBefore = calls.length;
  const again = await expandSeedTopic(deps, verticalId, flags.topic);
  const expansionCalls = calls.length - callsBefore;
  const approved = pages.find((page) => page.status === "APPROVED");
  if (approved) {
    // Simulate a crash after the draft was stored: the page is back in DRAFTING with its work intact.
    await db.page.update({ where: { id: approved.id }, data: { status: "DRAFTING" } });
    await runWorker(deps, { concurrency: 1 });
  }
  const after = await count();
  const resumeCalls = calls.length - callsBefore - expansionCalls;
  console.log(`\n  keyword expansion re-run: ${again.queued.length} new keywords (${expansionCalls} model call(s)); keyword rows ${before.keywords} → ${after.keywords}`);
  if (approved) {
    console.log(`  resumed "${approved.slug}" from DRAFTING: ${resumeCalls} model call(s); drafts ${before.drafts} → ${after.drafts}, evaluations ${before.evaluations} → ${after.evaluations}, fact sheets ${before.sheets} → ${after.sheets}`);
  }

  const final = await db.page.findMany({ select: { slug: true, status: true, qaScore: true } });
  const violations = [
    ...final.filter((page) => page.status === "APPROVED" && (page.qaScore ?? 0) < QA_PASS_THRESHOLD).map((page) => `${page.slug} approved below ${QA_PASS_THRESHOLD}`),
    ...(JSON.stringify(before) === JSON.stringify(after) ? [] : ["re-run changed row counts"]),
    ...(again.queued.length === 0 ? [] : ["re-run queued new keywords"]),
    ...(resumeCalls === 0 ? [] : ["resume made model calls"]),
  ];
  await db.pipelineRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), stats: { pages: final.length, modelCalls: calls.length, violations } },
  });
  await db.$disconnect();

  heading("Done");
  console.log(violations.length === 0 ? "  All invariants held: nothing below the threshold was approved, and the re-run was a no-op." : `  INVARIANT VIOLATIONS: ${violations.join("; ")}`);
  process.exit(violations.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
