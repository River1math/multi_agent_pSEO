import type { Db } from "../db/client";
import type { PageType as DbPageType } from "../generated/prisma/enums";
import { draftProse } from "../qa/text";
import { DraftContentSchema, type SiblingExcerpt } from "../schemas";

export interface ApprovedSibling {
  id: string;
  slug: string;
  title: string;
  entitySlugs: string[];
  entityNames: string[];
  headings: string[];
  prose: string;
}

const MAX_SIBLINGS = 50;

/**
 * Approved pages a new page could plausibly duplicate: those sharing a product or the page type.
 * Bounded so the comparison stays cheap; at a scale where 50 is not enough, select candidates by
 * LSH over the stored `minhash` instead of loading text.
 */
export async function loadApprovedSiblings(
  db: Db,
  page: { id: string; verticalId: string; pageType: DbPageType; entityIds: string[] },
): Promise<ApprovedSibling[]> {
  const rows = await db.page.findMany({
    where: {
      verticalId: page.verticalId,
      id: { not: page.id },
      status: { in: ["APPROVED", "PUBLISHED"] },
      OR: [{ pageType: page.pageType }, { entities: { some: { entityId: { in: page.entityIds } } } }],
    },
    orderBy: { contentUpdatedAt: "desc" },
    take: MAX_SIBLINGS,
    include: { entities: { include: { entity: true }, orderBy: { position: "asc" } } },
  });
  return rows.flatMap((row) => {
    const draft = DraftContentSchema.safeParse(row.content);
    if (!draft.success) return [];
    return [
      {
        id: row.id,
        slug: row.slug,
        title: draft.data.title,
        entitySlugs: row.entities.map((link) => link.entity.slug),
        entityNames: row.entities.map((link) => link.entity.name),
        headings: draft.data.blocks.flatMap((block) => block.heading ?? []),
        prose: draftProse(draft.data),
      },
    ];
  });
}

export function toExcerpt(sibling: ApprovedSibling): SiblingExcerpt {
  return {
    slug: sibling.slug,
    title: sibling.title,
    entityNames: sibling.entityNames,
    headings: sibling.headings,
    prose: sibling.prose.slice(0, 6000),
  };
}

/** The siblings a writer is most at risk of echoing: those covering the same products. */
export function nearestByEntities(siblings: readonly ApprovedSibling[], entitySlugs: readonly string[], limit = 3) {
  const wanted = new Set(entitySlugs);
  return siblings
    .map((sibling) => ({ sibling, shared: sibling.entitySlugs.filter((slug) => wanted.has(slug)).length }))
    .filter((entry) => entry.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit)
    .map((entry) => entry.sibling);
}
