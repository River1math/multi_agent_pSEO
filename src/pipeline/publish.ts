import type { Db } from "../db/client";
import { toJson } from "../db/client";
import type { DraftContent } from "../schemas/draft";

interface LinkCandidate {
  id: string;
  slug: string;
  title: string;
  pageType: string;
  entitySlugs: string[];
  tagSlugs: string[];
}

function sharedKeys(a: LinkCandidate, b: LinkCandidate): string[] {
  const aSet = new Set([...a.entitySlugs, ...a.tagSlugs]);
  return [...b.entitySlugs, ...b.tagSlugs].filter((k) => aSet.has(k));
}

function linkScore(shared: string[], fromType: string, toType: string): number {
  let score = shared.length * 10;
  if (fromType !== toType) score += 3;
  return score;
}

function anchorFor(to: LinkCandidate): string {
  return to.title;
}

export async function computeInternalLinks(db: Db): Promise<number> {
  const pages = await db.page.findMany({
    where: { status: { in: ["APPROVED", "PUBLISHED"] } },
    select: {
      id: true,
      slug: true,
      title: true,
      pageType: true,
      entities: { select: { entity: { select: { slug: true } } } },
      tags: { select: { slug: true } },
    },
  });

  const candidates: LinkCandidate[] = pages.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title ?? p.slug,
    pageType: p.pageType,
    entitySlugs: p.entities.map((e) => e.entity.slug),
    tagSlugs: p.tags.map((t) => t.slug),
  }));

  await db.internalLink.deleteMany({});

  let created = 0;
  const inboundCount = new Map<string, number>();

  for (const from of candidates) {
    const scored = candidates
      .filter((to) => to.id !== from.id)
      .map((to) => {
        const shared = sharedKeys(from, to);
        return { to, shared, score: linkScore(shared, from.pageType, to.pageType) };
      })
      .filter((entry) => entry.shared.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    for (let rank = 0; rank < scored.length; rank++) {
      const entry = scored[rank]!;
      await db.internalLink.create({
        data: {
          fromPageId: from.id,
          toPageId: entry.to.id,
          rank,
          score: entry.score,
          anchorText: anchorFor(entry.to),
          sharedKeys: toJson(entry.shared),
        },
      });
      inboundCount.set(entry.to.id, (inboundCount.get(entry.to.id) ?? 0) + 1);
      created++;
    }
  }

  // Ensure no orphans: every page has at least one inbound link.
  for (const page of candidates) {
    if ((inboundCount.get(page.id) ?? 0) > 0) continue;
    const bestLinker = candidates
      .filter((c) => c.id !== page.id)
      .map((c) => ({ c, shared: sharedKeys(c, page) }))
      .filter((e) => e.shared.length > 0)
      .sort((a, b) => b.shared.length - a.shared.length)[0];
    if (!bestLinker) continue;

    const existingCount = await db.internalLink.count({ where: { fromPageId: bestLinker.c.id } });
    await db.internalLink.create({
      data: {
        fromPageId: bestLinker.c.id,
        toPageId: page.id,
        rank: existingCount,
        score: linkScore(bestLinker.shared, bestLinker.c.pageType, page.pageType),
        anchorText: anchorFor(page),
        sharedKeys: toJson(bestLinker.shared),
      },
    });
    created++;
  }

  return created;
}

export async function publishApproved(db: Db): Promise<string[]> {
  const now = new Date();
  const approved = await db.page.findMany({ where: { status: "APPROVED" } });

  for (const page of approved) {
    await db.page.update({
      where: { id: page.id },
      data: { status: "PUBLISHED", publishedAt: now },
    });
  }

  const linkCount = await computeInternalLinks(db);

  const content = await db.page.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, content: true },
  });
  for (const page of content) {
    const draft = page.content as unknown as DraftContent | null;
    if (!draft) continue;
    const wordCount = draft.blocks.reduce((n, b) => n + b.bodyMarkdown.split(/\s+/).length, 0);
    await db.page.update({
      where: { id: page.id },
      data: { wordCount },
    });
  }

  console.log(`Published ${approved.length} page(s), created ${linkCount} internal link(s).`);
  return approved.map((p) => p.slug);
}
