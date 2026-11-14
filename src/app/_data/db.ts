import { createDb } from "../../db/client";

const dbUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

let _db: ReturnType<typeof createDb> | undefined;

export function getDb() {
  if (!_db) _db = createDb(dbUrl);
  return _db;
}
