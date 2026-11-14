import type { ExtractorInput, ToolFactSheet } from "../../schemas";
import type { FetchedSource, SourceFetcher } from "../../sources/types";
import type { EntitySeed } from "../../verticals/types";

/**
 * SIMULATED product data for the mock dry-run. Plan names and numbers are illustrative stand-ins,
 * not verified facts about these products: they exist to exercise the pipeline, and every source
 * URL is on the reserved `.invalid` domain so nothing here can be mistaken for fetched evidence.
 */

type Support = "yes" | "partial" | "no" | "unknown";

interface ToolSpec {
  slug: string;
  name: string;
  vendor: string;
  websiteUrl: string;
  category: ToolFactSheet["category"];
  positioning: string;
  launchedYear: number | null;
  openSource: boolean;
  license: string | null;
  platforms: string[];
  modelsSupported: string[];
  bringYourOwnKey: boolean;
  integrations: string[];
  compliance: ToolFactSheet["compliance"];
  pricingModel: ToolFactSheet["pricing"]["model"];
  tiers: Array<{
    id: string;
    name: string;
    monthly: number | null;
    annual: number | null;
    unit: "per_seat" | "flat" | "custom";
    limits: string[];
    inclusions: string[];
  }>;
  caveats: string[];
  features: Record<string, [Support, string | null]>;
  /** `inSource: false` leaves the metric out of the fixture page, to exercise the grounding check. */
  metrics: Array<{ id: string; label: string; value: number; unit: string; context: string; higherIsBetter: boolean; inSource: boolean }>;
  strengths: Array<[string, string]>;
  weaknesses: Array<[string, string]>;
  bestFor: string[];
  notIdealFor: string[];
  tags: string[];
}

const SPECS: ToolSpec[] = [
  {
    slug: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    websiteUrl: "https://cursor.com",
    category: "ai-code-editor",
    positioning: "A VS Code-based editor built around an agent that edits across files and runs commands.",
    launchedYear: 2023,
    openSource: false,
    license: null,
    platforms: ["macOS", "Windows", "Linux"],
    modelsSupported: ["Claude", "GPT", "Gemini", "Cursor in-house models"],
    bringYourOwnKey: true,
    integrations: ["GitHub", "GitLab", "Slack", "Linear"],
    compliance: ["soc2", "gdpr", "sso_saml", "zero_retention"],
    pricingModel: "freemium",
    tiers: [
      { id: "hobby", name: "Hobby", monthly: 0, annual: 0, unit: "flat", limits: ["Limited agent requests", "Limited tab completions"], inclusions: ["Agent mode trial"] },
      { id: "pro", name: "Pro", monthly: 20, annual: 16, unit: "flat", limits: ["Extended agent limits"], inclusions: ["Unlimited tab completions", "Cloud background agents"] },
      { id: "teams", name: "Teams", monthly: 40, annual: 32, unit: "per_seat", limits: ["Extended agent limits per seat"], inclusions: ["Central billing", "SAML SSO", "Org-wide privacy mode"] },
      { id: "enterprise", name: "Enterprise", monthly: null, annual: null, unit: "custom", limits: ["Pooled usage"], inclusions: ["SCIM", "Audit logs"] },
    ],
    caveats: ["Usage beyond the included agent limits is billed at model API rates."],
    features: {
      "inline-completion": ["yes", "Multi-line tab completion that predicts the next edit"],
      "agent-mode": ["yes", "Agent edits multiple files and runs terminal commands in one loop"],
      "codebase-indexing": ["yes", "Embeddings index of the whole repository"],
      "background-agents": ["yes", "Agents run unattended in cloud sandboxes and open pull requests"],
      "model-choice": ["yes", "Claude, GPT, Gemini and in-house models selectable per request"],
      "byo-api-key": ["partial", "Own keys work for chat and agent, not for tab completion"],
      "terminal-agent": ["yes", "Standalone CLI agent"],
      "pr-review": ["partial", "Bugbot review is a separately priced add-on"],
      "mcp-support": ["yes", "MCP servers configurable per project"],
      "jetbrains-support": ["no", "Ships only as its own VS Code-based editor"],
      "privacy-mode": ["yes", "Zero-retention privacy mode, enforceable org-wide on Teams"],
      "self-hosted": ["no", null],
    },
    metrics: [
      { id: "agent-context", label: "Agent context window", value: 200, unit: "K tokens", context: "Vendor docs, standard mode", higherIsBetter: true, inSource: true },
    ],
    strengths: [
      ["Agent-first workflow", "Agent mode edits multiple files and runs terminal commands in one loop"],
      ["Whole-repo awareness", "Builds an embeddings index of the whole repository rather than reading only open files"],
    ],
    weaknesses: [
      ["No JetBrains support", "It ships only as its own VS Code-based editor, so JetBrains users must switch IDEs"],
      ["Highest seat price in this set", "Teams costs $40 per seat on monthly billing"],
    ],
    bestFor: ["Developers who want an agent-first editor and already work in VS Code"],
    notIdealFor: ["Teams standardized on JetBrains IDEs"],
    tags: ["ai-code-editor", "vscode-fork", "agentic-coding"],
  },
  {
    slug: "github-copilot",
    name: "GitHub Copilot",
    vendor: "GitHub",
    websiteUrl: "https://github.com/features/copilot",
    category: "ide-extension",
    positioning: "An AI assistant delivered as plugins for existing IDEs and built into GitHub.",
    launchedYear: 2021,
    openSource: false,
    license: null,
    platforms: ["VS Code", "JetBrains", "Neovim", "Xcode", "Visual Studio"],
    modelsSupported: ["GPT", "Claude", "Gemini"],
    bringYourOwnKey: true,
    integrations: ["GitHub Issues", "GitHub Actions", "GitHub Pull Requests"],
    compliance: ["soc2", "iso27001", "gdpr", "sso_saml"],
    pricingModel: "freemium",
    tiers: [
      { id: "free", name: "Free", monthly: 0, annual: 0, unit: "flat", limits: ["2,000 completions per month", "50 chat requests per month"], inclusions: ["Agent mode"] },
      { id: "pro", name: "Pro", monthly: 10, annual: null, unit: "flat", limits: ["300 premium requests per month"], inclusions: ["Unlimited completions", "Coding agent"] },
      { id: "business", name: "Business", monthly: 19, annual: null, unit: "per_seat", limits: ["300 premium requests per user per month"], inclusions: ["Policy controls", "Code excluded from training"] },
      { id: "enterprise", name: "Enterprise", monthly: 39, annual: null, unit: "per_seat", limits: ["1,000 premium requests per user per month"], inclusions: ["Knowledge bases", "Custom models"] },
    ],
    caveats: ["Premium requests beyond the plan allowance are billed per request."],
    features: {
      "inline-completion": ["yes", "Completions in every supported IDE"],
      "agent-mode": ["yes", "Agent mode in VS Code and JetBrains"],
      "codebase-indexing": ["partial", "Remote index covers GitHub-hosted repositories only"],
      "background-agents": ["yes", "Coding agent works on assigned issues inside GitHub Actions"],
      "model-choice": ["yes", "GPT, Claude and Gemini models selectable in chat"],
      "byo-api-key": ["partial", "Own keys are limited to chat in supported IDEs"],
      "terminal-agent": ["yes", "Copilot CLI"],
      "pr-review": ["yes", "Copilot code review comments directly on pull requests"],
      "mcp-support": ["yes", "MCP servers in agent mode"],
      "jetbrains-support": ["yes", "Official plugin with agent mode"],
      "privacy-mode": ["yes", "Business and Enterprise exclude code from model training"],
      "self-hosted": ["no", null],
    },
    metrics: [
      { id: "premium-requests", label: "Premium requests included on Pro", value: 300, unit: "per month", context: "Vendor plan page", higherIsBetter: true, inSource: true },
    ],
    strengths: [
      ["Lowest paid entry price", "Pro costs $10 per month"],
      ["Stays in your current IDE", "Official plugins cover VS Code, JetBrains, Neovim, Xcode and Visual Studio"],
    ],
    weaknesses: [
      ["Indexing tied to GitHub", "Its remote codebase index covers GitHub-hosted repositories only"],
      ["Metered premium models", "Pro includes 300 premium requests per month, with extra requests billed individually"],
    ],
    bestFor: ["Teams already on GitHub that want AI inside the IDEs they use today"],
    notIdealFor: ["Codebases hosted outside GitHub that need full remote indexing"],
    tags: ["ide-extension", "agentic-coding", "github-ecosystem"],
  },
  {
    slug: "windsurf",
    name: "Windsurf",
    vendor: "Windsurf",
    websiteUrl: "https://windsurf.com",
    category: "ai-code-editor",
    positioning: "A VS Code-based editor whose Cascade agent is also available as a JetBrains plugin.",
    launchedYear: 2024,
    openSource: false,
    license: null,
    platforms: ["macOS", "Windows", "Linux", "JetBrains plugin"],
    modelsSupported: ["Claude", "GPT", "Gemini", "Windsurf in-house models"],
    bringYourOwnKey: true,
    integrations: ["GitHub", "Netlify", "Figma"],
    compliance: ["soc2", "gdpr", "sso_saml", "zero_retention"],
    pricingModel: "freemium",
    tiers: [
      { id: "free", name: "Free", monthly: 0, annual: 0, unit: "flat", limits: ["25 prompt credits per month"], inclusions: ["Unlimited tab completions"] },
      { id: "pro", name: "Pro", monthly: 15, annual: null, unit: "flat", limits: ["500 prompt credits per month"], inclusions: ["Cascade agent", "App deploys"] },
      { id: "teams", name: "Teams", monthly: 30, annual: null, unit: "per_seat", limits: ["500 prompt credits per user per month"], inclusions: ["Central billing", "Windsurf Reviews"] },
      { id: "enterprise", name: "Enterprise", monthly: null, annual: null, unit: "custom", limits: ["Negotiated credits"], inclusions: ["Hybrid deployment", "SAML SSO"] },
    ],
    caveats: ["Agent actions consume prompt credits; extra credits are sold in add-on packs."],
    features: {
      "inline-completion": ["yes", "Unlimited tab completions on every plan"],
      "agent-mode": ["yes", "Cascade agent plans and applies multi-file edits"],
      "codebase-indexing": ["yes", "Local index of the whole repository"],
      "background-agents": ["no", "Agent work runs only inside the open editor session"],
      "model-choice": ["yes", "Claude, GPT, Gemini and in-house models"],
      "byo-api-key": ["partial", "Own keys accepted for selected Claude models only"],
      "terminal-agent": ["partial", "Agent runs commands in the editor terminal; no standalone CLI"],
      "pr-review": ["partial", "Windsurf Reviews is limited to Teams and Enterprise"],
      "mcp-support": ["yes", "MCP servers available to Cascade"],
      "jetbrains-support": ["yes", "Plugin includes the Cascade agent"],
      "privacy-mode": ["yes", "Zero-retention mode on paid plans"],
      "self-hosted": ["partial", "Hybrid deployment on Enterprise"],
    },
    metrics: [
      { id: "prompt-credits", label: "Prompt credits included on Pro", value: 500, unit: "per month", context: "Vendor plan page", higherIsBetter: true, inSource: true },
    ],
    strengths: [
      ["Lower seat price than Cursor", "Teams costs $30 per seat"],
      ["Agent inside JetBrains", "Its JetBrains plugin includes the Cascade agent, not only completions"],
    ],
    weaknesses: [
      ["No cloud background agents", "Agent work runs only inside the open editor session"],
      ["Credit-metered agent", "Pro includes 500 prompt credits per month and agent actions draw them down"],
    ],
    bestFor: ["Small teams that want an agentic editor at a lower seat price"],
    notIdealFor: ["Workflows that rely on unattended cloud agents"],
    tags: ["ai-code-editor", "vscode-fork", "agentic-coding"],
  },
  {
    slug: "zed",
    name: "Zed",
    vendor: "Zed Industries",
    websiteUrl: "https://zed.dev",
    category: "ai-code-editor",
    positioning: "An open-source native editor with an agent panel and first-class support for your own model keys.",
    launchedYear: 2023,
    openSource: true,
    license: "GPL-3.0",
    platforms: ["macOS", "Linux", "Windows"],
    modelsSupported: ["Claude", "GPT", "Gemini", "Local models via Ollama"],
    bringYourOwnKey: true,
    integrations: ["GitHub", "Ollama", "External CLI agents"],
    compliance: ["soc2", "gdpr"],
    pricingModel: "freemium",
    tiers: [
      { id: "personal", name: "Personal", monthly: 0, annual: 0, unit: "flat", limits: ["50 hosted prompts per month"], inclusions: ["Unlimited use with your own API keys"] },
      { id: "pro", name: "Pro", monthly: 10, annual: null, unit: "flat", limits: ["500 hosted prompts per month"], inclusions: ["Unlimited edit predictions"] },
      { id: "enterprise", name: "Enterprise", monthly: null, annual: null, unit: "custom", limits: ["Negotiated usage"], inclusions: ["SSO", "Usage analytics"] },
    ],
    caveats: ["Hosted prompts beyond the plan allowance are billed by usage; own-key usage is not metered by Zed."],
    features: {
      "inline-completion": ["yes", "Edit prediction"],
      "agent-mode": ["yes", "Agent panel edits across files"],
      "codebase-indexing": ["partial", "No embeddings index; the agent searches the project on demand"],
      "background-agents": ["no", null],
      "model-choice": ["yes", "Hosted Claude, GPT and Gemini, or any provider through your own key"],
      "byo-api-key": ["yes", "Any provider key, plus local models through Ollama, for all AI features"],
      "terminal-agent": ["partial", "Runs external CLI agents inside the editor"],
      "pr-review": ["no", null],
      "mcp-support": ["yes", "MCP servers installable as extensions"],
      "jetbrains-support": ["no", "Native editor only"],
      "privacy-mode": ["yes", "Prompts are not retained or used for training by default"],
      "self-hosted": ["no", null],
    },
    metrics: [
      { id: "hosted-prompts", label: "Hosted prompts included on Pro", value: 500, unit: "per month", context: "Vendor plan page", higherIsBetter: true, inSource: true },
      { id: "cold-start", label: "Cold start time", value: 120, unit: "ms", context: "Unsourced claim", higherIsBetter: false, inSource: false },
    ],
    strengths: [
      ["Full bring-your-own-key support", "Accepts any provider key and local models through Ollama for all AI features"],
      ["Open source", "The editor is released under GPL-3.0"],
    ],
    weaknesses: [
      ["No pull-request review", "It has no automated pull-request review feature"],
      ["No codebase index", "The agent searches the project on demand instead of using an embeddings index"],
    ],
    bestFor: ["Developers who would rather pay model providers directly and keep the editor free"],
    notIdealFor: ["Teams that need pull-request review and cloud agents in one product"],
    tags: ["ai-code-editor", "open-source", "native-performance"],
  },
];

const specFor = (slug: string): ToolSpec => {
  const spec = SPECS.find((candidate) => candidate.slug === slug);
  if (!spec) throw new Error(`mock fixtures have no product "${slug}"`);
  return spec;
};

const FIXTURE_HOST = "https://fixtures.invalid";
const money = (value: number | null) => (value === null ? "custom pricing" : `$${value}`);

/** Stands in for web_fetch: returns fixture pages instead of fetching the vendor's site. */
export class MockSourceFetcher implements SourceFetcher {
  readonly name = "mock fixtures";

  async fetch(entity: EntitySeed): Promise<FetchedSource[]> {
    const spec = specFor(entity.slug);
    const header = `SIMULATED FIXTURE — not fetched from ${entity.websiteUrl}; values are illustrative.`;
    const pricing = [
      header,
      `${spec.name} plans`,
      ...spec.tiers.map((tier) =>
        `${tier.name}: ${money(tier.monthly)} per month${tier.annual ? `, or ${money(tier.annual)} per month billed annually` : ""}${tier.unit === "per_seat" ? " per seat" : ""}. ${[...tier.limits, ...tier.inclusions].join(". ")}.`,
      ),
      ...spec.caveats,
    ].join("\n");
    const docs = [
      header,
      `${spec.name} documentation`,
      ...Object.entries(spec.features).map(([key, [support, detail]]) => `${key}: ${support}${detail ? ` — ${detail}` : ""}`),
      ...spec.metrics.filter((metric) => metric.inSource).map((metric) => `${metric.label}: ${metric.value} ${metric.unit} (${metric.context})`),
    ].join("\n");
    const fetchedAt = new Date();
    return [
      { url: `${FIXTURE_HOST}/${spec.slug}/pricing`, kind: "PRICING_PAGE", content: pricing, fetchedAt, httpStatus: 200 },
      { url: `${FIXTURE_HOST}/${spec.slug}/docs`, kind: "DOCS", content: docs, fetchedAt, httpStatus: 200 },
    ];
  }
}

/** What a model would extract from the fixture pages above. */
export function simulateFactSheet(input: ExtractorInput): ToolFactSheet {
  const spec = specFor(input.entitySlug);
  const sourceOf = (kind: string) => {
    const source = input.sources.find((candidate) => candidate.kind === kind) ?? input.sources[0];
    return { sourceUrl: source?.url ?? null, asOf: source?.fetchedAt ?? null, confidence: "verified" as const };
  };
  const point = (prefix: string) => ([claim, because]: [string, string], index: number) => ({ id: `${prefix}-${index + 1}`, claim, because });

  return {
    entitySlug: spec.slug,
    name: spec.name,
    vendor: spec.vendor,
    websiteUrl: spec.websiteUrl,
    category: spec.category,
    positioning: spec.positioning,
    launchedYear: spec.launchedYear,
    openSource: spec.openSource,
    license: spec.license,
    deployment: ["cloud"],
    platforms: spec.platforms,
    modelsSupported: spec.modelsSupported,
    bringYourOwnKey: spec.bringYourOwnKey,
    integrations: spec.integrations,
    compliance: spec.compliance,
    pricing: {
      model: spec.pricingModel,
      hasFreeTier: spec.tiers.some((tier) => tier.monthly === 0),
      freeTrialDays: null,
      tiers: spec.tiers.map((tier) => ({
        id: `tier-${tier.id}`,
        name: tier.name,
        priceUsdMonthly: tier.monthly,
        priceUsdAnnualPerMonth: tier.annual,
        billingUnit: tier.unit,
        usageLimits: tier.limits,
        keyInclusions: tier.inclusions,
        evidence: sourceOf("PRICING_PAGE"),
      })),
      caveats: spec.caveats,
    },
    features: input.featureTaxonomy.map(({ featureKey }) => {
      const [support, detail] = spec.features[featureKey] ?? ["unknown", null];
      return { featureKey, support, detail, evidence: sourceOf("DOCS") };
    }),
    metrics: spec.metrics.map(({ inSource: _inSource, ...metric }) => ({ ...metric, id: `metric-${metric.id}`, evidence: sourceOf("DOCS") })),
    strengths: spec.strengths.map(point("strength")),
    weaknesses: spec.weaknesses.map(point("weakness")),
    bestFor: spec.bestFor,
    notIdealFor: spec.notIdealFor,
    tags: spec.tags,
  };
}
