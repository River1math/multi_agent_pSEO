export function KeyTakeaways({ items }: { items: string[] }) {
  return (
    <div
      className="rounded-lg p-5 my-6"
      style={{ background: "var(--color-accent-muted)", border: "1px solid var(--color-accent)" }}
    >
      <h2 className="text-base font-bold mb-3" style={{ color: "var(--color-text-heading)" }}>
        Key Takeaways
      </h2>
      <ul className="space-y-2 text-sm">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 mt-0.5" style={{ color: "var(--color-accent)" }}>✓</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
