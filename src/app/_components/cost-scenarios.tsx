import type { CostScenario } from "../../schemas/page-data";

function formatUsd(amount: number | null): string {
  if (amount === null) return "Custom";
  return `$${amount.toFixed(0)}/mo`;
}

export function CostScenarios({
  scenarios,
  entityNames,
}: {
  scenarios: CostScenario[];
  entityNames: Map<string, string>;
}) {
  if (scenarios.length === 0) return null;

  return (
    <div className="space-y-4">
      {scenarios.map((scenario) => (
        <div
          key={scenario.id}
          className="rounded-lg p-4"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
        >
          <div className="flex items-baseline justify-between mb-3">
            <h4 className="font-semibold" style={{ color: "var(--color-text-heading)" }}>
              {scenario.label}
            </h4>
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {scenario.seats} seat{scenario.seats > 1 ? "s" : ""} · {scenario.billing}
            </span>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${scenario.costs.length}, 1fr)` }}>
            {scenario.costs.map((cost) => (
              <div key={cost.entitySlug} className="text-center">
                <p className="text-xs font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>
                  {entityNames.get(cost.entitySlug) ?? cost.entitySlug}
                </p>
                <p className="text-lg font-bold" style={{ color: "var(--color-text-heading)" }}>
                  {formatUsd(cost.monthlyUsd)}
                </p>
                {cost.note && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                    {cost.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
