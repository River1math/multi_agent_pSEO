import { extractFactSheet } from "../agents/extractor";
import { toJson } from "../db/client";
import { sha256 } from "../lib/hash";
import { ToolFactSheetSchema, type ToolFactSheet } from "../schemas";
import type { PipelineDeps } from "./context";

const FACT_SHEET_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const FACT_SHEET_SCHEMA_VERSION = 1;

export interface CurrentFactSheet {
  id: string;
  sheet: ToolFactSheet;
  reused: boolean;
}

/** Extractions in flight, so pages that need the same product at once share one extraction. */
const inFlight = new Map<string, Promise<CurrentFactSheet>>();

/**
 * Returns a fresh fact sheet for an entity, extracting one only when none is current. Pages reuse
 * the same sheet, which is both the cost saving and the cross-page consistency guarantee.
 */
export function ensureFactSheet(
  deps: PipelineDeps,
  entity: { id: string; slug: string; name: string },
  pageId: string | null,
): Promise<CurrentFactSheet> {
  const pending = inFlight.get(entity.id);
  if (pending) return pending;
  const work = loadOrExtract(deps, entity, pageId).finally(() => inFlight.delete(entity.id));
  inFlight.set(entity.id, work);
  return work;
}

async function loadOrExtract(
  deps: PipelineDeps,
  entity: { id: string; slug: string; name: string },
  pageId: string | null,
): Promise<CurrentFactSheet> {
  const { db, log } = deps;
  const scope = `entity ${entity.slug}`;

  const current = await db.entityFactSheet.findFirst({
    where: { entityId: entity.id, isCurrent: true, extractedAt: { gt: new Date(Date.now() - FACT_SHEET_TTL_MS) } },
  });
  if (current) {
    log.info(scope, `fact sheet v${current.version} is current → reused, no model call`);
    return { id: current.id, sheet: ToolFactSheetSchema.parse(current.data), reused: true };
  }

  const seed = deps.vertical.entities.find((candidate) => candidate.slug === entity.slug);
  if (!seed) throw new Error(`entity "${entity.slug}" is not in the vertical registry`);
  const sources = await deps.sources.fetch(seed);
  if (sources.length === 0) throw new Error(`no source pages could be fetched for "${entity.slug}"`);
  log.info(scope, `fetched ${sources.length} source page(s) via ${deps.sources.name}`);

  for (const source of sources) {
    const contentHash = sha256(source.content);
    await db.sourceDocument.upsert({
      where: { entityId_url_contentHash: { entityId: entity.id, url: source.url, contentHash } },
      create: { entityId: entity.id, url: source.url, kind: source.kind, contentHash, content: source.content, httpStatus: source.httpStatus, fetchedAt: source.fetchedAt },
      update: { fetchedAt: source.fetchedAt },
    });
  }

  const extraction = await extractFactSheet(
    deps.llm,
    {
      entitySlug: entity.slug,
      entityName: entity.name,
      featureTaxonomy: deps.vertical.featureTaxonomy.map(({ featureKey, label }) => ({ featureKey, label })),
      sources: sources.map((source) => ({
        url: source.url,
        kind: source.kind,
        fetchedAt: source.fetchedAt.toISOString().slice(0, 10),
        content: source.content,
      })),
    },
    pageId,
  );
  if (extraction.downgradedClaims > 0) {
    log.warn(scope, `${extraction.downgradedClaims} claim(s) not found in their cited source → downgraded to "inferred"`);
  }

  const contentHash = sha256(extraction.sheet);
  const saved = await db.$transaction(async (tx) => {
    await tx.entityFactSheet.updateMany({ where: { entityId: entity.id, isCurrent: true }, data: { isCurrent: false } });
    const latest = await tx.entityFactSheet.findFirst({ where: { entityId: entity.id }, orderBy: { version: "desc" } });
    // Unchanged facts re-confirm the existing version instead of creating a new one.
    return tx.entityFactSheet.upsert({
      where: { entityId_contentHash: { entityId: entity.id, contentHash } },
      create: {
        entityId: entity.id,
        version: (latest?.version ?? 0) + 1,
        schemaVersion: FACT_SHEET_SCHEMA_VERSION,
        data: toJson(extraction.sheet),
        contentHash,
        isCurrent: true,
        model: extraction.model,
      },
      update: { isCurrent: true, extractedAt: new Date() },
    });
  });
  const tiers = extraction.sheet.pricing.tiers.length;
  log.info(scope, `fact sheet v${saved.version} stored (${tiers} tiers, ${extraction.sheet.features.length} features)`);
  return { id: saved.id, sheet: extraction.sheet, reused: false };
}
