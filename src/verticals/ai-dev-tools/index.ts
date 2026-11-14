import type { VerticalConfig } from "../types";

/**
 * Default vertical: AI Developer Tools & SaaS Comparisons.
 * Source URLs are the vendors' pricing and docs pages as best known when this was written; verify
 * them before the first live run, since a moved page just yields an empty source.
 */
export const aiDevTools: VerticalConfig = {
  slug: "ai-dev-tools",
  name: "AI Developer Tools & SaaS Comparisons",
  schemaKey: "tool-fact-sheet-v1",
  featureTaxonomy: [
    { featureKey: "inline-completion", label: "Inline code completion", group: "capabilities" },
    { featureKey: "agent-mode", label: "Multi-file agent mode", group: "capabilities" },
    { featureKey: "codebase-indexing", label: "Whole-codebase indexing", group: "capabilities" },
    { featureKey: "background-agents", label: "Cloud background agents", group: "capabilities" },
    { featureKey: "model-choice", label: "Choice of frontier models", group: "models" },
    { featureKey: "byo-api-key", label: "Bring your own API key", group: "models" },
    { featureKey: "terminal-agent", label: "Terminal / CLI agent", group: "workflow" },
    { featureKey: "pr-review", label: "Automated pull-request review", group: "workflow" },
    { featureKey: "mcp-support", label: "MCP tool integrations", group: "ecosystem" },
    { featureKey: "jetbrains-support", label: "JetBrains IDE support", group: "ecosystem" },
    { featureKey: "privacy-mode", label: "Zero-retention privacy mode", group: "security" },
    { featureKey: "self-hosted", label: "Self-hosted deployment", group: "security" },
  ],
  entities: [
    {
      slug: "cursor",
      name: "Cursor",
      aliases: ["cursor ai", "cursor ide", "cursor editor"],
      category: "ai-code-editor",
      websiteUrl: "https://cursor.com",
      sources: [
        { url: "https://cursor.com/pricing", kind: "PRICING_PAGE" },
        { url: "https://cursor.com/docs", kind: "DOCS" },
      ],
      tags: ["ai-code-editor", "vscode-fork", "agentic-coding"],
    },
    {
      slug: "github-copilot",
      name: "GitHub Copilot",
      aliases: ["copilot", "gh copilot", "github copilot chat"],
      category: "ide-extension",
      websiteUrl: "https://github.com/features/copilot",
      sources: [
        { url: "https://github.com/features/copilot/plans", kind: "PRICING_PAGE" },
        { url: "https://docs.github.com/en/copilot", kind: "DOCS" },
      ],
      tags: ["ide-extension", "agentic-coding", "github-ecosystem"],
    },
    {
      slug: "windsurf",
      name: "Windsurf",
      aliases: ["windsurf editor", "windsurf ide", "codeium"],
      category: "ai-code-editor",
      websiteUrl: "https://windsurf.com",
      sources: [
        { url: "https://windsurf.com/pricing", kind: "PRICING_PAGE" },
        { url: "https://docs.windsurf.com", kind: "DOCS" },
      ],
      tags: ["ai-code-editor", "vscode-fork", "agentic-coding"],
    },
    {
      slug: "zed",
      name: "Zed",
      aliases: ["zed editor", "zed ai", "zed.dev"],
      category: "ai-code-editor",
      websiteUrl: "https://zed.dev",
      sources: [
        { url: "https://zed.dev/pricing", kind: "PRICING_PAGE" },
        { url: "https://zed.dev/docs", kind: "DOCS" },
      ],
      tags: ["ai-code-editor", "open-source", "native-performance"],
    },
  ],
};
