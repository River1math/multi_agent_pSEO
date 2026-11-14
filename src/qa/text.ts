import type { DraftContent } from "../schemas";

/** Markdown → plain text, enough for comparison and counting. */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/[*_`>#]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** All model-written text of a draft, one paragraph per element. */
export function draftProse(draft: DraftContent): string {
  return [
    ...draft.keyTakeaways,
    ...draft.blocks.map((block) => block.bodyMarkdown),
    ...draft.faqAnswers.map((answer) => answer.answerMarkdown),
  ]
    .map(stripMarkdown)
    .join("\n\n");
}

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Tokens for similarity. Product names are replaced by one placeholder first, so a page that
 * reuses a sibling's sentences with the names swapped still counts as the same text.
 */
export function comparisonTokens(text: string, entityNames: readonly string[]): string[] {
  let masked = text.toLowerCase();
  for (const name of [...entityNames].sort((a, b) => b.length - a.length)) {
    masked = masked.replace(new RegExp(`\\b${escapeRegExp(name.toLowerCase())}\\b`, "g"), "ENTITY");
  }
  return masked.replace(/[^a-zA-Z0-9$%.]+/g, " ").split(" ").filter(Boolean);
}

export function shingles(tokens: readonly string[], size = 3): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + size <= tokens.length; i++) set.add(tokens.slice(i, i + size).join(" "));
  return set;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Share of `a` that also appears in `b`. */
export function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / a.size;
}

function fnv1a(text: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export const MINHASH_SIZE = 64;

/** Fixed-size fingerprint stored on the page; lets siblings be ranked without loading their text. */
export function minhash(set: ReadonlySet<string>, size = MINHASH_SIZE): number[] {
  const signature = new Array<number>(size).fill(0xffffffff);
  for (const item of set) {
    for (let i = 0; i < size; i++) {
      const hash = fnv1a(item, i * 0x9e3779b1);
      if (hash < (signature[i] ?? 0xffffffff)) signature[i] = hash;
    }
  }
  return signature;
}

export function estimateJaccard(a: readonly number[], b: readonly number[]): number {
  const size = Math.min(a.length, b.length);
  if (size === 0) return 0;
  let equal = 0;
  for (let i = 0; i < size; i++) if (a[i] === b[i]) equal++;
  return equal / size;
}

/** Numeric tokens as they appear in text, normalized: "$1,200" → "1200", "37%" → "37". */
export function numbersIn(text: string): Array<{ raw: string; value: string; marked: boolean }> {
  const found: Array<{ raw: string; value: string; marked: boolean }> = [];
  for (const match of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const raw = match[0];
    const value = String(Number(raw.replace(/[$,%]/g, "")));
    if (value !== "NaN") found.push({ raw, value, marked: raw.startsWith("$") || raw.endsWith("%") });
  }
  return found;
}
