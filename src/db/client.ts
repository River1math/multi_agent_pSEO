import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "../generated/prisma/client";

export type Db = PrismaClient;
/** Either the client or an interactive-transaction handle. */
export type DbTx = Prisma.TransactionClient;

export const DEFAULT_DATABASE_URL = "file:./prisma/dev.db";

/**
 * SQLite through a driver adapter. Moving to Postgres is a provider change in schema.prisma plus
 * swapping this adapter for @prisma/adapter-pg; no query in the pipeline is SQLite-specific.
 */
export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Db {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

export const toJson = (value: unknown) => value as Prisma.InputJsonValue;
