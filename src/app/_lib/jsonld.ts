import type { PublishedPage } from "../_data/queries";

export function faqPageJsonLd(page: PublishedPage): object {
  const faqs = page.structuredData.faqs;
  const answerMap = new Map(page.content.faqAnswers.map((a) => [a.faqId, a.answerMarkdown]));

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: answerMap.get(faq.id) ?? faq.answer,
      },
    })),
  };
}

export function softwareApplicationJsonLd(
  entity: { name: string; websiteUrl: string | null; category: string },
  factSheet: { pricing: { hasFreeTier: boolean; tiers: { priceUsdMonthly: number | null }[] } } | null,
): object {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: entity.name,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, macOS, Windows, Linux",
  };
  if (entity.websiteUrl) ld.url = entity.websiteUrl;

  if (factSheet) {
    const freeTier = factSheet.pricing.hasFreeTier;
    const paidTiers = factSheet.pricing.tiers.filter((t) => t.priceUsdMonthly !== null && t.priceUsdMonthly > 0);
    if (freeTier) {
      ld.offers = { "@type": "Offer", price: "0", priceCurrency: "USD" };
    } else if (paidTiers.length > 0) {
      const lowest = Math.min(...paidTiers.map((t) => t.priceUsdMonthly!));
      ld.offers = { "@type": "Offer", price: String(lowest), priceCurrency: "USD" };
    }
  }

  return ld;
}

export function breadcrumbJsonLd(page: PublishedPage, baseUrl: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: baseUrl },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${baseUrl}/guides` },
      { "@type": "ListItem", position: 3, name: page.title },
    ],
  };
}
