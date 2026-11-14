import { runKeywordAgent } from "../agents/keyword";
import { toJson } from "../db/client";
import { sha256 } from "../lib/hash";
import { slugify } from "../lib/slug";
import type { KeywordAgentOutput, QueuedKeyword } from "../schemas";
import { toDbPageType, type PipelineDeps } from "./context";

type IntentEnum = "INFORMATIONAL" | "COMMERCIAL" | "TRANSACTIONAL" | "NAVIGATIONAL";

/** Runs the Keyword Agent for one seed topic and upserts the result into the queue. */
export async function expandSeedTopic(
  deps: PipelineDeps,
  verticalId: string,
  topic: string,
  maxCandidates = 25,
): Promise<KeywordAgentOutput> {
  const { db, vertical } = deps;
  const seedTopic = await db.seedTopic.upsert({
    where: { verticalId_topic: { verticalId, topic } },
    create: { verticalId, topic },
    update: {},
  });
  const existing = await db.keyword.findMany({ where: { verticalId }, select: { canonicalKey: true, phrase: true } });

  const entityAliases = new Map<string, string>();
  for (const entity of vertical.entities) {
    for (const name of [entity.slug, entity.name, ...entity.aliases]) entityAliases.set(slugify(name), entity.slug);
  }

  const output = await runKeywordAgent(
    deps.llm,
    {
      verticalSlug: vertical.slug,
      seedTopic: topic,
      knownEntitySlugs: vertical.entities.map((entity) => entity.slug),
      existingCanonicalKeys: existing.map((keyword) => keyword.canonicalKey),
      maxCandidates,
    },
    {
      entityAliases,
      knownCategories: new Set(vertical.entities.map((entity) => entity.category)),
      alreadyQueued: existing,
    },
  );

  const fields = (keyword: QueuedKeyword) => ({
    phrase: keyword.phrase,
    pageType: toDbPageType(keyword.pageType),
    intent: keyword.intent.toUpperCase() as IntentEnum,
    entitySlugs: toJson(keyword.entitySlugs),
    categorySlug: keyword.categorySlug,
    modifier: keyword.modifier,
    priority: keyword.priority,
    signals: toJson(keyword.signals),
  });
  const keyOf = (canonicalKey: string) => ({ verticalId_canonicalKey: { verticalId, canonicalKey } });

  // Upserts keyed on the canonical key: re-running an expansion never creates a second row.
  for (const keyword of output.queued) {
    await db.keyword.upsert({
      where: keyOf(keyword.canonicalKey),
      create: { verticalId, seedTopicId: seedTopic.id, canonicalKey: keyword.canonicalKey, ...fields(keyword) },
      update: {},
    });
  }
  for (const duplicate of output.duplicates) {
    if (duplicate.detectedBy !== "model") continue; // same-key duplicates already are the kept row
    const kept = await db.keyword.findUnique({ where: keyOf(duplicate.duplicateOfKey), select: { id: true } });
    await db.keyword.upsert({
      where: keyOf(duplicate.candidate.canonicalKey),
      create: {
        verticalId,
        seedTopicId: seedTopic.id,
        canonicalKey: duplicate.candidate.canonicalKey,
        ...fields(duplicate.candidate),
        status: "DUPLICATE",
        duplicateOfId: kept?.id ?? null,
      },
      update: {},
    });
  }
  await db.seedTopic.update({ where: { id: seedTopic.id }, data: { expandedAt: new Date() } });
  return output;
}

const MAX_CANDIDATE_ENTITIES = 6;

/** Turns the highest-priority queued keywords into pages for the workers to pick up. */
export async function enqueuePages(deps: PipelineDeps, verticalId: string, limit: number): Promise<string[]> {
  const { db } = deps;
  const keywords = await db.keyword.findMany({
    where: { verticalId, status: "QUEUED" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit,
  });
  const entities = await db.entity.findMany({ where: { verticalId } });
  const bySlug = new Map(entities.map((entity) => [entity.slug, entity]));
  const pageIds: string[] = [];

  for (const keyword of keywords) {
    const named = (keyword.entitySlugs as string[]).flatMap((slug) => bySlug.get(slug) ?? []);
    const namedIds = new Set(named.map((entity) => entity.id));
    // Pages that rank or suggest products need a candidate pool beyond the ones named in the query.
    const pool =
      keyword.pageType === "VERSUS"
        ? []
        : entities
            .filter((entity) => !namedIds.has(entity.id))
            .filter((entity) => keyword.pageType === "ALTERNATIVES" || entity.category === keyword.categorySlug)
            .slice(0, MAX_CANDIDATE_ENTITIES - named.length);

    const base = slugify(keyword.phrase);
    const taken = await db.page.findUnique({ where: { slug: base }, select: { keywordId: true } });
    const slug = taken && taken.keywordId !== keyword.id ? `${base.slice(0, 72)}-${sha256(keyword.canonicalKey).slice(0, 6)}` : base;

    const page = await db.$transaction(async (tx) => {
      const created = await tx.page.upsert({
        where: { keywordId: keyword.id },
        create: {
          verticalId,
          keywordId: keyword.id,
          slug,
          pageType: keyword.pageType,
          entities: {
            create: [
              ...named.map((entity, position) => ({ entityId: entity.id, role: "PRIMARY" as const, position })),
              ...pool.map((entity, index) => ({ entityId: entity.id, role: "CANDIDATE" as const, position: named.length + index })),
            ],
          },
        },
        update: {},
      });
      await tx.keyword.update({ where: { id: keyword.id }, data: { status: "CLAIMED" } });
      return created;
    });
    pageIds.push(page.id);
  }
  return pageIds;
}
