import type { MatrixRow } from "../../schemas/page-data";

const GROUP_ORDER = ["pricing", "capabilities", "models", "workflow", "security", "ecosystem"] as const;
const GROUP_LABELS: Record<string, string> = {
  pricing: "Pricing",
  capabilities: "Capabilities",
  models: "Models",
  workflow: "Workflow",
  security: "Security",
  ecosystem: "Ecosystem",
};

export function ComparisonMatrix({ rows, entityNames }: { rows: MatrixRow[]; entityNames: string[] }) {
  const grouped = new Map<string, MatrixRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.group) ?? [];
    list.push(row);
    grouped.set(row.group, list);
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm border-collapse" style={{ minWidth: 600 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
            <th className="text-left py-3 px-3 font-semibold" style={{ color: "var(--color-text-heading)", width: "28%" }}>
              Feature
            </th>
            {entityNames.map((name) => (
              <th key={name} className="text-left py-3 px-3 font-semibold" style={{ color: "var(--color-text-heading)" }}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
            <>
              <tr key={`group-${group}`}>
                <td
                  colSpan={entityNames.length + 1}
                  className="pt-4 pb-2 px-3 text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {GROUP_LABELS[group] ?? group}
                </td>
              </tr>
              {grouped.get(group)!.map((row) => (
                <tr key={row.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="py-2.5 px-3 font-medium" style={{ color: "var(--color-text-heading)" }}>
                    {row.dimension}
                  </td>
                  {row.cells.map((cell) => {
                    const isWinner = row.winnerSlug === cell.entitySlug;
                    return (
                      <td
                        key={cell.entitySlug}
                        className="py-2.5 px-3"
                        style={isWinner ? { color: "var(--color-win)", fontWeight: 600 } : undefined}
                      >
                        {cell.display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
