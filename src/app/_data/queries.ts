import "server-only";
import { cache } from "react";
import { getDb } from "./db";
import type { PageData } from "../../schemas/page-data";
import type { DraftContent } from "../../schemas/draft";
import type { ToolFactSheet } from "../../schemas/entity";

export interface PublishedPage {
  id: string;
  slug: string;
  pageType: string;
  title: string;
  metaDescription: string;
  structuredData: PageData;
  content: DraftContent;
  qaScore: number;
  wordCount: number;
  publishedAt: Date;
  contentUpdatedAt: Date;
  tags: { slug: string; label: string; kind: string }[];
  entities: {
    role: string;
    position: number;
    entity: { slug: string; name: string; websiteUrl: string | null; category: string };
    factSheet: { data: ToolFactSheet } | null;
  }[];
  linksOut: {
    rank: number;
    anchorText: string;
    score: number;
    sharedKeys: string[];
    to: { slug: string; title: string | null; pageType: string };
  }[];
}

export const getPublishedPage = cache(async (slug: string): Promise<PublishedPage | null> => {
  const db = getDb();
  const page = await db.page.findUnique({
    where: { slug, status: "PUBLISHED" },
    include: {
      tags: true,
      entities: {
        orderBy: { position: "asc" },
        include: {
          entity: true,
          factSheet: true,
        },
      },
      linksOut: {
        orderBy: { rank: "asc" },
        take: 6,
        include: { to: { select: { slug: true, title: true, pageType: true } } },
      },
    },
  });
  if (!page || !page.content || !page.structuredData || !page.title) return null;
  return {
    id: page.id,
    slug: page.slug,
    pageType: page.pageType,
    title: page.title,
    metaDescription: page.metaDescription ?? "",
    structuredData: page.structuredData as unknown as PageData,
    content: page.content as unknown as DraftContent,
    qaScore: page.qaScore ?? 0,
    wordCount: page.wordCount ?? 0,
    publishedAt: page.publishedAt ?? page.createdAt,
    contentUpdatedAt: page.contentUpdatedAt ?? page.createdAt,
    tags: page.tags.map((t) => ({ slug: t.slug, label: t.label, kind: t.kind })),
    entities: page.entities.map((pe) => ({
      role: pe.role,
      position: pe.position,
      entity: {
        slug: pe.entity.slug,
        name: pe.entity.name,
        websiteUrl: pe.entity.websiteUrl,
        category: pe.entity.category,
      },
      factSheet: pe.factSheet ? { data: pe.factSheet.data as unknown as ToolFactSheet } : null,
    })),
    linksOut: page.linksOut.map((link) => ({
      rank: link.rank,
      anchorText: link.anchorText,
      score: link.score,
      sharedKeys: (link.sharedKeys as string[]) ?? [],
      to: link.to,
    })),
  };
});

export const getAllPublishedSlugs = cache(async (): Promise<string[]> => {
  const db = getDb();
  const pages = await db.page.findMany({
    where: { status: "PUBLISHED" },
    select: { slug: true },
    orderBy: { publishedAt: "desc" },
  });
  return pages.map((p) => p.slug);
});

export interface SitemapEntry {
  slug: string;
  contentUpdatedAt: Date | null;
}

export const getSitemapEntries = cache(
  async (offset: number, limit: number): Promise<SitemapEntry[]> => {
    const db = getDb();
    const args: Parameters<typeof db.page.findMany>[0] = {
      where: { status: "PUBLISHED" },
      select: { slug: true, contentUpdatedAt: true },
      orderBy: { slug: "asc" },
      take: limit,
    };
    if (offset > 0) args.skip = offset;
    return db.page.findMany(args);
  },
);

export const getPublishedPageCount = cache(async (): Promise<number> => {
  const db = getDb();
  return db.page.count({ where: { status: "PUBLISHED" } });
});
