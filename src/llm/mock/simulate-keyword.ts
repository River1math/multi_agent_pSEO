import type { KeywordAgentInput, KeywordCandidate, KeywordDedup, KeywordDedupInput } from "../../schemas";

type Tier = "high" | "medium" | "low";

const candidate = (
  phrase: string,
  pageType: KeywordCandidate["pageType"],
  entitySlugs: string[],
  categorySlug: string | null,
  modifier: string | null,
  demand: Tier,
  competition: Tier,
  commercialValue: number,
  rationale: string,
): KeywordCandidate => ({
  phrase,
  pageType,
  intent: "commercial",
  entitySlugs,
  categorySlug,
  modifier,
  signals: {
    demand,
    competition,
    commercialValue,
    serpFeatures: pageType === "versus" ? ["comparison_table", "people_also_ask", "forum"] : ["featured_snippet", "people_also_ask"],
    searchVolume: null,
    volumeSource: "model_estimate",
    rationale,
  },
});

/**
 * A scripted expansion that contains what a real one would: a reversed-order repeat, an alias, a
 * same-audience niche under another name, and a product outside the registry.
 */
const SCRIPT: KeywordCandidate[] = [
  candidate("Cursor vs GitHub Copilot", "versus", ["cursor", "github-copilot"], null, null, "high", "high", 5, "Head-to-head between the two most-searched AI coding tools."),
  candidate("GitHub Copilot vs Cursor", "versus", ["copilot", "cursor"], null, null, "high", "high", 5, "Reverse word order of the same comparison."),
  candidate("Best AI code editor for solo founders", "best_for", [], "ai-code-editor", "solo founders", "medium", "low", 4, "Budget-sensitive niche where entry price decides the ranking."),
  candidate("Best AI code editor for indie hackers", "best_for", [], "ai-code-editor", "indie hackers", "medium", "low", 3, "Same audience as solo founders under another name."),
  candidate("Cursor vs Windsurf", "versus", ["cursor", "windsurf"], null, null, "medium", "medium", 4, "Two VS Code forks with different seat prices."),
  candidate("Windsurf alternatives", "alternatives", ["windsurf"], null, null, "medium", "medium", 3, "Searchers already using the product and looking to switch."),
  candidate("Cursor vs Devin", "versus", ["cursor", "devin"], null, null, "medium", "medium", 4, "Editor against an autonomous agent product."),
  candidate("Zed vs Cursor", "versus", ["zed", "cursor"], null, null, "low", "low", 3, "Open-source native editor against the category leader."),
];

export function simulateKeywordExpansion(input: KeywordAgentInput) {
  return { candidates: SCRIPT.slice(0, input.maxCandidates) };
}

/** Niches that name the same audience. */
const SAME_AUDIENCE = [["solo founders", "indie hackers", "solopreneurs"]];

export function simulateKeywordDedup(input: KeywordDedupInput): KeywordDedup {
  const groupOf = (keyword: { canonicalKey: string; phrase: string }) => {
    const phrase = keyword.phrase.toLowerCase();
    const group = SAME_AUDIENCE.findIndex((names) => names.some((name) => phrase.includes(name)));
    // Same audience only makes a duplicate when the page type and category also match.
    return group === -1 ? null : `${keyword.canonicalKey.split(":").slice(0, 2).join(":")}:${group}`;
  };
  const keepers = new Map<string, { canonicalKey: string; phrase: string }>(
    input.alreadyQueued.flatMap((keyword) => {
      const group = groupOf(keyword);
      return group ? [[group, keyword] as const] : [];
    }),
  );
  const duplicates: KeywordDedup["duplicates"] = [];
  for (const keyword of [...input.candidates].sort((a, b) => b.priority - a.priority)) {
    const group = groupOf(keyword);
    if (!group) continue;
    const keeper = keepers.get(group);
    if (!keeper) keepers.set(group, keyword);
    else {
      duplicates.push({
        canonicalKey: keyword.canonicalKey,
        duplicateOfKey: keeper.canonicalKey,
        reason: `"${keyword.phrase}" and "${keeper.phrase}" describe the same audience; one page answers both.`,
      });
    }
  }
  return { duplicates };
}
