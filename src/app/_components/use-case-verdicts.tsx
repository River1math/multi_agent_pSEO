import type { UseCaseVerdict } from "../../schemas/page-data";

export function UseCaseVerdicts({
  verdicts,
  entityNames,
}: {
  verdicts: UseCaseVerdict[];
  entityNames: Map<string, string>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {verdicts.map((v) => (
        <div
          key={v.id}
          className="rounded-lg p-4"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
        >
          <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "var(--color-accent)" }}>
            {entityNames.get(v.pickSlug) ?? v.pickSlug}
          </p>
          <p className="font-semibold mb-2" style={{ color: "var(--color-text-heading)" }}>
            {v.useCase}
          </p>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {v.reasoning}
          </p>
          {v.caveat && (
            <p className="text-xs mt-2 italic" style={{ color: "var(--color-text-muted)" }}>
              Caveat: {v.caveat}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
