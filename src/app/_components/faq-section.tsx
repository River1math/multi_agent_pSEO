import type { Faq } from "../../schemas/page-data";
import type { DraftContent } from "../../schemas/draft";

export function FaqSection({ faqs, answers }: { faqs: Faq[]; answers: DraftContent["faqAnswers"] }) {
  const answerMap = new Map(answers.map((a) => [a.faqId, a.answerMarkdown]));

  return (
    <div className="space-y-0 divide-y" style={{ borderColor: "var(--color-border)" }}>
      {faqs.map((faq) => {
        const answer = answerMap.get(faq.id) ?? faq.answer;
        return (
          <details key={faq.id} className="group py-4">
            <summary
              className="cursor-pointer font-semibold list-none flex items-center justify-between"
              style={{ color: "var(--color-text-heading)" }}
            >
              {faq.question}
              <span
                className="ml-2 transition-transform group-open:rotate-180 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                ▼
              </span>
            </summary>
            <div className="mt-3 text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
              {answer}
            </div>
          </details>
        );
      })}
    </div>
  );
}
