/** Renders a named payload for a prompt. Compact JSON with insertion-ordered keys: deterministic and token-lean. */
export function payload(tag: string, value: unknown): string {
  return `<${tag}>\n${JSON.stringify(value)}\n</${tag}>`;
}
