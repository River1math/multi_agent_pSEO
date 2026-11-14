import type { Db } from "../db/client";
import type { PageType as DbPageType } from "../generated/prisma/enums";
import type { Logger } from "../lib/log";
import type { LlmGateway } from "../llm/gateway";
import type { PageType } from "../schemas";
import type { SourceFetcher } from "../sources/types";
import type { VerticalConfig } from "../verticals/types";

export interface PipelineDeps {
  db: Db;
  llm: LlmGateway;
  sources: SourceFetcher;
  vertical: VerticalConfig;
  log: Logger;
  /** Identifies this process in page leases. */
  workerId: string;
}

export const toDbPageType = (type: PageType): DbPageType => type.toUpperCase() as DbPageType;
export const fromDbPageType = (type: DbPageType): PageType => type.toLowerCase() as PageType;

/** Names and aliases of every product in the vertical; masked out when comparing page text. */
export function entityNamesOf(vertical: VerticalConfig): string[] {
  return vertical.entities.flatMap((entity) => [entity.name, ...entity.aliases]);
}
