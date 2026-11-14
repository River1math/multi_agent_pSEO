import type { DbTx } from "../db/client";
import { toJson } from "../db/client";
import type { TagKind } from "../generated/prisma/enums";
import type { PipelineDeps } from "./context";

export function tagKindFor(slug: string, deps: Pick<PipelineDeps, "vertical">): TagKind {
  if (deps.vertical.entities.some((entity) => entity.category === slug)) return "CATEGORY";
  if (deps.vertical.featureTaxonomy.some((feature) => feature.featureKey === slug)) return "FEATURE";
  return "USE_CASE";
}

export async function upsertTags(db: DbTx, slugs: readonly string[], deps: Pick<PipelineDeps, "vertical">) {
  const unique = [...new Set(slugs)];
  for (const slug of unique) {
    await db.tag.upsert({
      where: { slug },
      create: { slug, label: slug.replace(/-/g, " "), kind: tagKindFor(slug, deps) },
      update: {},
    });
  }
  return unique.map((slug) => ({ slug }));
}

/** Idempotently registers the vertical and its entities. Safe to run at the start of every run. */
export async function seedVertical(deps: Pick<PipelineDeps, "db" | "vertical">): Promise<string> {
  const { db, vertical } = deps;
  const row = await db.vertical.upsert({
    where: { slug: vertical.slug },
    create: { slug: vertical.slug, name: vertical.name, schemaKey: vertical.schemaKey },
    update: { name: vertical.name, schemaKey: vertical.schemaKey },
  });
  for (const entity of vertical.entities) {
    const tags = await upsertTags(db, entity.tags, deps);
    const fields = {
      name: entity.name,
      websiteUrl: entity.websiteUrl,
      category: entity.category,
      aliases: toJson(entity.aliases),
    };
    await db.entity.upsert({
      where: { verticalId_slug: { verticalId: row.id, slug: entity.slug } },
      create: { verticalId: row.id, slug: entity.slug, ...fields, tags: { connect: tags } },
      update: { ...fields, tags: { set: tags } },
    });
  }
  return row.id;
}
