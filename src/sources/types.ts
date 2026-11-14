import type { SourceKind } from "../generated/prisma/enums";
import type { EntitySeed } from "../verticals/types";

export interface FetchedSource {
  url: string;
  kind: SourceKind;
  content: string;
  fetchedAt: Date;
  httpStatus: number | null;
}

/** Retrieves the first-party pages a fact sheet is extracted from. */
export interface SourceFetcher {
  readonly name: string;
  fetch(entity: EntitySeed): Promise<FetchedSource[]>;
}
