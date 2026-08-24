import { Schema } from "effect"

export const CatalogSource = Schema.Literals(["huggingface", "seed", "overlay"])
export type CatalogSource = typeof CatalogSource.Type

export const CatalogFreshness = Schema.Literals(["live", "fresh-cache", "stale-cache", "seed"])
export type CatalogFreshness = typeof CatalogFreshness.Type

export const Provenance = Schema.Struct({
  source: CatalogSource,
  repository: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.String),
  fetchedAt: Schema.optional(Schema.String),
  freshness: CatalogFreshness,
})
export type Provenance = typeof Provenance.Type

export const ArtifactRole = Schema.Literals(["weights", "projection", "tokenizer", "config", "auxiliary"])
export type ArtifactRole = typeof ArtifactRole.Type

export const ModelFormat = Schema.Literals(["gguf", "mlx", "safetensors", "awq", "gptq", "unknown"])
export type ModelFormat = typeof ModelFormat.Type

export const ModelArtifact = Schema.Struct({
  path: Schema.String,
  role: ArtifactRole,
  size: Schema.NullOr(Schema.Number),
  digest: Schema.NullOr(Schema.String),
  downloadURL: Schema.String,
})
export type ModelArtifact = typeof ModelArtifact.Type

export const ModelVariant = Schema.Struct({
  id: Schema.String,
  repository: Schema.String,
  revision: Schema.String,
  format: ModelFormat,
  quantization: Schema.NullOr(Schema.String),
  artifacts: Schema.Array(ModelArtifact),
  totalBytes: Schema.NullOr(Schema.Number),
  complete: Schema.Boolean,
})
export type ModelVariant = typeof ModelVariant.Type

export const ModelEvidence = Schema.Struct({
  // "provenance" and "recency" were added for the gallery's explained
  // ranking (model-gallery-ui 5.5). Extending this list is backward
  // compatible: existing emitters keep using the kinds they always did.
  kind: Schema.Literals(["fit", "context", "quality", "speed", "capability", "popularity", "provenance", "recency"]),
  source: Schema.String,
  measured: Schema.Boolean,
  value: Schema.Unknown,
})
export type ModelEvidence = typeof ModelEvidence.Type

export const ModelPolicy = Schema.Struct({
  allowed: Schema.Boolean,
  reasons: Schema.Array(Schema.String),
})
export type ModelPolicy = typeof ModelPolicy.Type

export const ModelCandidate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  author: Schema.NullOr(Schema.String),
  repository: Schema.String,
  revision: Schema.NullOr(Schema.String),
  architecture: Schema.NullOr(Schema.String),
  parameterCount: Schema.NullOr(Schema.Number),
  activeParameterCount: Schema.NullOr(Schema.Number),
  trainedContext: Schema.NullOr(Schema.Number),
  pipelineTag: Schema.NullOr(Schema.String),
  capabilities: Schema.Array(Schema.String),
  languages: Schema.Array(Schema.String),
  license: Schema.NullOr(Schema.String),
  downloads: Schema.Number,
  likes: Schema.Number,
  tags: Schema.Array(Schema.String),
  variants: Schema.Array(ModelVariant),
  provenance: Provenance,
  policy: ModelPolicy,
})
export type ModelCandidate = typeof ModelCandidate.Type

export const CatalogSearchResult = Schema.Struct({
  query: Schema.String,
  candidates: Schema.Array(ModelCandidate),
})
export type CatalogSearchResult = typeof CatalogSearchResult.Type
