/**
 * Queue worker for the configured database (DATABASE_URL).
 *
 *   npx tsx scripts/worker.ts --expand "AI code editors" --enqueue 20 --concurrency 4
 *   npx tsx scripts/worker.ts --mock ...      simulated models and sources instead of the API
 *
 * Without --expand / --enqueue it only drains pages already in the queue.
 */
import { parseArgs } from "node:util";
import { createDb } from "../src/db/client";
import { consoleLogger } from "../src/lib/log";
import { AnthropicTransport } from "../src/llm/anthropic-transport";
import { LlmGateway } from "../src/llm/gateway";
import { MockSourceFetcher } from "../src/llm/mock/fixtures";
import { MockTransport } from "../src/llm/mock/transport";
import type { PipelineDeps } from "../src/pipeline/context";
import { enqueuePages, expandSeedTopic } from "../src/pipeline/keywords";
import { runWorker } from "../src/pipeline/orchestrator";
import { seedVertical } from "../src/pipeline/seed";
import { ClaudeWebFetchSource } from "../src/sources/claude-web-fetch";
import { aiDevTools } from "../src/verticals/ai-dev-tools";

const { values: flags } = parseArgs({
  options: {
    mock: { type: "boolean", default: false },
    expand: { type: "string" },
    enqueue: { type: "string", default: "0" },
    concurrency: { type: "string", default: "3" },
  },
});

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file; rely on the process environment
  }
  const db = createDb();
  const log = consoleLogger();
  const run = await db.pipelineRun.create({ data: {} });
  const llm = new LlmGateway({
    transport: flags.mock ? new MockTransport({ scenarios: {} }) : new AnthropicTransport(),
    log,
    concurrency: 4,
    onCall: async ({ task: _task, tier: _tier, ...row }) => {
      await db.agentCall.create({ data: { ...row, runId: run.id } });
    },
  });
  const deps: PipelineDeps = {
    db,
    llm,
    sources: flags.mock ? new MockSourceFetcher() : new ClaudeWebFetchSource(),
    vertical: aiDevTools,
    log,
    workerId: `worker-${process.pid}`,
  };

  const verticalId = await seedVertical(deps);
  if (flags.expand) {
    const result = await expandSeedTopic(deps, verticalId, flags.expand);
    log.info("keywords", `${result.queued.length} queued, ${result.duplicates.length} duplicate, ${result.skipped.length} skipped`);
  }
  if (Number(flags.enqueue) > 0) await enqueuePages(deps, verticalId, Number(flags.enqueue));

  const processed = await runWorker(deps, { concurrency: Number(flags.concurrency) });
  const byStatus = await db.page.groupBy({ by: ["status"], _count: true });
  log.info("worker", `processed ${processed} page(s); queue now: ${byStatus.map((row) => `${row.status} ${row._count}`).join(", ") || "empty"}`);
  await db.pipelineRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), stats: { processed } } });
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
