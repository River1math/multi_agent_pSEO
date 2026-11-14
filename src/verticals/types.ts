import type { SourceKind } from "../generated/prisma/enums";

export interface FeatureDefinition {
  featureKey: string;
  label: string;
  group: "capabilities" | "models" | "workflow" | "security" | "ecosystem";
}

export interface EntitySeed {
  slug: string;
  name: string;
  aliases: string[];
  category: string;
  websiteUrl: string;
  /** First-party pages the Extractor is grounded on. */
  sources: Array<{ url: string; kind: SourceKind }>;
  tags: string[];
}

export interface VerticalConfig {
  slug: string;
  name: string;
  schemaKey: string;
  featureTaxonomy: FeatureDefinition[];
  entities: EntitySeed[];
}
