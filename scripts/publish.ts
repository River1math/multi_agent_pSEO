/**
 * Move all APPROVED pages to PUBLISHED and compute the internal link graph.
 *
 *   npm run publish                         uses DATABASE_URL or default dev.db
 *   npm run publish -- --db prisma/dry-run/run-2026-01-01T00-00-00-000Z.db   target a specific dry-run DB
 */
import { parseArgs } from "node:util";
import { createDb } from "../src/db/client";
import { publishApproved } from "../src/pipeline/publish";

const { values: flags } = parseArgs({
  options: { db: { type: "string" } },
});

const dbUrl = flags.db ? `file:./${flags.db}` : (process.env.DATABASE_URL ?? "file:./prisma/dev.db");
console.log(`Publishing from ${dbUrl}`);

const db = createDb(dbUrl);
const slugs = await publishApproved(db);
if (slugs.length === 0) console.log("No APPROVED pages found.");
else console.log(`Now PUBLISHED: ${slugs.join(", ")}`);
await db.$disconnect();
