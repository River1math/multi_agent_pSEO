import Link from "next/link";
import { getAllPublishedSlugs, getPublishedPage } from "./_data/queries";
import { SampleBanner } from "./_components/sample-banner";

export const revalidate = 3600;

const TYPE_LABELS: Record<string, string> = {
  VERSUS: "Comparison",
  BEST_FOR: "Best For",
  ALTERNATIVES: "Alternatives",
};

export default async function HomePage() {
  const slugs = await getAllPublishedSlugs();
  const pages = await Promise.all(slugs.map((slug) => getPublishedPage(slug)));
  const published = pages.filter((p): p is NonNullable<typeof p> => p !== null);
  const isSample = !process.env.NEXT_PUBLIC_SITE_URL;

  return (
    <>
      {isSample && <SampleBanner />}
      <main className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-extrabold mb-2" style={{ color: "var(--color-text-heading)" }}>
          AI Dev Tools Compare
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--color-text-muted)" }}>
          Side-by-side comparisons, rankings and alternatives for AI developer tools.
        </p>

        {published.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>
            No published guides yet. Run the pipeline and publish script first.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {published.map((page) => (
              <Link
                key={page.slug}
                href={`/guides/${page.slug}`}
                className="block rounded-lg p-5 transition-colors no-underline"
                style={{
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
              >
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--color-accent)" }}
                >
                  {TYPE_LABELS[page.pageType] ?? page.pageType}
                </span>
                <p className="font-semibold mt-1 mb-2" style={{ color: "var(--color-text-heading)" }}>
                  {page.title}
                </p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {page.metaDescription}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
