import type { MetadataRoute } from "next";
import { getSitemapEntries, getPublishedPageCount } from "./_data/queries";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";
const URLS_PER_SITEMAP = 10_000;

export async function generateSitemaps() {
  const total = await getPublishedPageCount();
  const count = Math.max(1, Math.ceil(total / URLS_PER_SITEMAP));
  return Array.from({ length: count }, (_, i) => ({ id: i }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const skip = id * URLS_PER_SITEMAP;
  const entries = await getSitemapEntries(skip, URLS_PER_SITEMAP);

  return entries.map((entry) => ({
    url: `${BASE_URL}/guides/${entry.slug}`,
    lastModified: entry.contentUpdatedAt ?? undefined,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));
}
