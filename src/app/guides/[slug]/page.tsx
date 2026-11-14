import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPage, getAllPublishedSlugs } from "../../_data/queries";
import { SampleBanner } from "../../_components/sample-banner";
import { KeyTakeaways } from "../../_components/key-takeaways";
import { ComparisonMatrix } from "../../_components/comparison-matrix";
import { CopyBlocks } from "../../_components/copy-blocks";
import { UseCaseVerdicts } from "../../_components/use-case-verdicts";
import { CostScenarios } from "../../_components/cost-scenarios";
import { FaqSection } from "../../_components/faq-section";
import { RelatedGuides } from "../../_components/related-guides";
import { faqPageJsonLd, softwareApplicationJsonLd, breadcrumbJsonLd } from "../../_lib/jsonld";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";

export async function generateStaticParams() {
  const slugs = await getAllPublishedSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) return {};

  return {
    title: page.title,
    description: page.metaDescription,
    alternates: { canonical: `${BASE_URL}/guides/${page.slug}` },
    openGraph: {
      title: page.title,
      description: page.metaDescription,
      type: "article",
      url: `${BASE_URL}/guides/${page.slug}`,
      publishedTime: page.publishedAt.toISOString(),
      modifiedTime: page.contentUpdatedAt.toISOString(),
      siteName: "AI Dev Tools Compare",
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.metaDescription,
    },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) notFound();

  const entityNames = new Map(page.entities.map((e) => [e.entity.slug, e.entity.name]));
  const entityNameList = page.entities.map((e) => e.entity.name);
  const data = page.structuredData;
  const isSample = !process.env.NEXT_PUBLIC_SITE_URL;

  const jsonLdScripts = [
    faqPageJsonLd(page),
    breadcrumbJsonLd(page, BASE_URL),
    ...page.entities
      .filter((e) => e.factSheet)
      .map((e) => softwareApplicationJsonLd(e.entity, e.factSheet?.data ?? null)),
  ];

  return (
    <>
      {isSample && <SampleBanner />}

      {jsonLdScripts.map((ld, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
        />
      ))}

      <article className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
        {/* Breadcrumb */}
        <nav className="text-xs mb-6" style={{ color: "var(--color-text-muted)" }} aria-label="Breadcrumb">
          <a href="/" className="hover:underline" style={{ color: "var(--color-accent)" }}>Home</a>
          <span className="mx-1.5">/</span>
          <a href="/guides" className="hover:underline" style={{ color: "var(--color-accent)" }}>Guides</a>
          <span className="mx-1.5">/</span>
          <span>{page.title}</span>
        </nav>

        {/* Page type badge */}
        <div className="mb-3">
          <span
            className="inline-block text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{ background: "var(--color-accent-muted)", color: "var(--color-accent)" }}
          >
            {page.pageType.replace("_", " ")}
          </span>
        </div>

        {/* H1 */}
        <h1
          className="text-3xl sm:text-4xl font-extrabold leading-tight mb-2"
          style={{ color: "var(--color-text-heading)" }}
        >
          {page.content.h1}
        </h1>

        {/* Meta line */}
        <p className="text-sm mb-8" style={{ color: "var(--color-text-muted)" }}>
          Updated {page.contentUpdatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          {" · "}{page.wordCount} words
          {page.tags.length > 0 && (
            <>
              {" · "}
              {page.tags.map((t) => t.label).join(", ")}
            </>
          )}
        </p>

        {/* Key takeaways */}
        <KeyTakeaways items={page.content.keyTakeaways} />

        {/* Intro block (first block) */}
        <CopyBlocks blocks={page.content.blocks.filter((b) => b.kind === "intro")} />

        {/* Bottom line (versus pages) */}
        {data.pageType === "versus" && data.bottomLine && (
          <div
            className="rounded-lg p-5 my-8"
            style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}
          >
            <h2 className="text-base font-bold mb-2" style={{ color: "var(--color-text-heading)" }}>
              Bottom Line
            </h2>
            <p className="text-sm">{data.bottomLine.summary}</p>
            {data.bottomLine.overallPickSlug && (
              <p className="text-sm font-semibold mt-2" style={{ color: "var(--color-win)" }}>
                Overall pick: {entityNames.get(data.bottomLine.overallPickSlug)}
              </p>
            )}
          </div>
        )}

        {/* Comparison matrix */}
        <section className="my-10">
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--color-text-heading)" }}>
            Feature Comparison
          </h2>
          <ComparisonMatrix rows={data.matrix} entityNames={entityNameList} />
        </section>

        {/* Analysis & pricing commentary blocks */}
        <CopyBlocks blocks={page.content.blocks.filter((b) => b.kind === "analysis" || b.kind === "pricing_commentary")} />

        {/* Cost scenarios */}
        {data.costScenarios.length > 0 && (
          <section className="my-10">
            <h2 className="text-xl font-bold mb-4" style={{ color: "var(--color-text-heading)" }}>
              Cost Comparison
            </h2>
            <CostScenarios scenarios={data.costScenarios} entityNames={entityNames} />
          </section>
        )}

        {/* Use-case verdicts */}
        <section className="my-10">
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--color-text-heading)" }}>
            Who Should Pick What
          </h2>
          <UseCaseVerdicts verdicts={data.useCaseVerdicts} entityNames={entityNames} />
        </section>

        {/* Verdict block */}
        <CopyBlocks blocks={page.content.blocks.filter((b) => b.kind === "verdict")} />

        {/* FAQ */}
        <section className="my-10">
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--color-text-heading)" }}>
            Frequently Asked Questions
          </h2>
          <FaqSection faqs={data.faqs} answers={page.content.faqAnswers} />
        </section>

        {/* Related guides */}
        <section className="my-10 pt-8" style={{ borderTop: "1px solid var(--color-border)" }}>
          <RelatedGuides links={page.linksOut} />
        </section>
      </article>
    </>
  );
}
