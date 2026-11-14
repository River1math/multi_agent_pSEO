import Link from "next/link";

interface RelatedLink {
  rank: number;
  anchorText: string;
  to: { slug: string; title: string | null; pageType: string };
}

const TYPE_LABELS: Record<string, string> = {
  VERSUS: "Comparison",
  BEST_FOR: "Best For",
  ALTERNATIVES: "Alternatives",
};

export function RelatedGuides({ links }: { links: RelatedLink[] }) {
  if (links.length === 0) return null;

  return (
    <nav aria-label="Related guides">
      <h2 className="text-lg font-bold mb-4" style={{ color: "var(--color-text-heading)" }}>
        Related Guides
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.to.slug}
            href={`/guides/${link.to.slug}`}
            className="block rounded-lg p-4 transition-colors no-underline"
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
              {TYPE_LABELS[link.to.pageType] ?? link.to.pageType}
            </span>
            <p className="font-semibold mt-1" style={{ color: "var(--color-text-heading)" }}>
              {link.anchorText}
            </p>
          </Link>
        ))}
      </div>
    </nav>
  );
}
