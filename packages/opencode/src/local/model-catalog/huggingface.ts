import { Schema } from "effect"
import type { CatalogSearchResult, ModelArtifact, ModelCandidate, ModelPolicy, ModelVariant } from "./types"

const DEFAULT_ENDPOINT = "https://huggingface.co"
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

const Sibling = Schema.Struct({
  rfilename: Schema.String,
  size: Schema.optional(Schema.Number),
  blobId: Schema.optional(Schema.String),
  lfs: Schema.optional(
    Schema.Struct({
      sha256: Schema.optional(Schema.String),
      size: Schema.optional(Schema.Number),
    }),
  ),
})

const HubModel = Schema.Struct({
  id: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  gated: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
  private: Schema.optional(Schema.Boolean),
  disabled: Schema.optional(Schema.Boolean),
  sha: Schema.optional(Schema.String),
  downloads: Schema.optional(Schema.Number),
  likes: Schema.optional(Schema.Number),
  tags: Schema.optional(Schema.Array(Schema.String)),
  pipeline_tag: Schema.optional(Schema.String),
  lastModified: Schema.optional(Schema.String),
  siblings: Schema.optional(Schema.Array(Sibling)),
  cardData: Schema.optional(
    Schema.Struct({
      license: Schema.optional(Schema.String),
      language: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    }),
  ),
  gguf: Schema.optional(
    Schema.Struct({
      architecture: Schema.optional(Schema.String),
      context_length: Schema.optional(Schema.Number),
      total: Schema.optional(Schema.Number),
    }),
  ),
  config: Schema.optional(
    Schema.Struct({
      num_experts: Schema.optional(Schema.Number),
      num_experts_per_tok: Schema.optional(Schema.Number),
    }),
  ),
})

const decodeModels = Schema.decodeUnknownSync(Schema.Array(HubModel))
const decodeModel = Schema.decodeUnknownSync(HubModel)

export type HuggingFaceClientOptions = {
  endpoint?: string
  fetch?: typeof globalThis.fetch
}

export type SearchModelsInput = {
  query?: string
  limit?: number
  signal?: AbortSignal
}

export type ResolveRepositoryInput = {
  repository: string
  revision?: string
  signal?: AbortSignal
}

export function createHuggingFaceCatalog(options: HuggingFaceClientOptions = {}) {
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "")
  const request = options.fetch ?? globalThis.fetch

  return {
    async search(input: SearchModelsInput = {}): Promise<CatalogSearchResult> {
      const query = normalizeSearch(input.query)
      const url = new URL(`${endpoint}/api/models`)
      url.searchParams.set("search", query)
      url.searchParams.set("sort", "downloads")
      url.searchParams.set("direction", "-1")
      url.searchParams.set("limit", String(boundedLimit(input.limit)))
      url.searchParams.set("full", "false")

      const models = decodeModels(await fetchJSON(request, url, input.signal))
      return {
        query: input.query?.trim() ?? "",
        candidates: models
          .filter((model) => model.tags?.some((tag) => tag.toLowerCase() === "gguf") || hasGGUF(model))
          .map((model) => toCandidate(model, "live")),
      }
    },

    async resolve(input: ResolveRepositoryInput): Promise<ModelCandidate> {
      const repository = parseRepository(input.repository)
      const requested = input.revision?.trim()
      const initial = requested
        ? undefined
        : decodeModel(
            await fetchJSON(request, new URL(`${endpoint}/api/models/${encodeRepository(repository)}`), input.signal),
          )
      const revision = requested || initial?.sha
      if (!revision) throw new Error(`Hugging Face did not return a revision for ${repository}`)

      const url = new URL(
        `${endpoint}/api/models/${encodeRepository(repository)}/revision/${encodeURIComponent(revision)}`,
      )
      url.searchParams.set("blobs", "true")
      const model = decodeModel(await fetchJSON(request, url, input.signal))
      if (!model.sha) throw new Error(`Hugging Face did not resolve ${repository}@${revision} to an immutable revision`)

      const candidate = toCandidate(model, "live")
      const variants = variantsFromSiblings(repository, model.sha, model.siblings ?? [], endpoint)
      return {
        ...candidate,
        id: repository,
        repository,
        revision: model.sha,
        variants,
        policy: withVariantPolicy(candidate.policy, variants),
      }
    },
  }
}

// Top-level Hugging Face URL segments that are resource types, not organization
// namespaces. Without this check, "huggingface.co/spaces/foo/bar" silently
// parsed as repository "spaces/foo" — a plausible-looking but wrong ID, not an
// error — because the code only knew to strip the literal "models" segment and
// treated everything else as if it were an org name.
const NON_MODEL_URL_SEGMENTS = new Set([
  "spaces",
  "datasets",
  "papers",
  "posts",
  "collections",
  "docs",
  "blog",
  "organizations",
  "settings",
])

export function parseRepository(value: string): string {
  const input = value.trim().replace(/^hf:\/\//i, "")
  const pathname = input.startsWith("http://") || input.startsWith("https://") ? new URL(input).pathname : input
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "models") parts.shift()
  else if (parts[0] && NON_MODEL_URL_SEGMENTS.has(parts[0].toLowerCase()))
    throw new Error(`Invalid Hugging Face repository: ${value} (this is a Hugging Face "${parts[0]}" URL, not a model)`)
  if (parts.length < 2) throw new Error(`Invalid Hugging Face repository: ${value}`)
  return `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`
}

function normalizeSearch(query?: string) {
  const value = query?.trim() ?? ""
  if (!value) return "gguf"
  if (/(^|\s)gguf($|\s)/i.test(value)) return value
  return `${value} gguf`
}

function boundedLimit(limit?: number) {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)))
}

async function fetchJSON(request: typeof globalThis.fetch, url: URL, signal?: AbortSignal) {
  const response = await request(url, {
    headers: { accept: "application/json" },
    signal,
  })
  if (!response.ok) throw new Error(`Hugging Face request failed (${response.status}) for ${url.pathname}`)
  return response.json()
}

function hasGGUF(model: typeof HubModel.Type) {
  return model.siblings?.some((file) => file.rfilename.toLowerCase().endsWith(".gguf")) ?? false
}

function toCandidate(model: typeof HubModel.Type, freshness: "live"): ModelCandidate {
  const repository = model.modelId ?? model.id
  if (!repository) throw new Error("Hugging Face model is missing its repository ID")
  const language = model.cardData?.language
  const license = model.cardData?.license ?? tagValue(model.tags ?? [], "license") ?? null
  return {
    id: repository,
    name: repository.split("/").at(-1) ?? repository,
    author: model.author ?? repository.split("/")[0] ?? null,
    repository,
    revision: model.sha ?? null,
    architecture: model.gguf?.architecture ?? null,
    parameterCount: model.gguf?.total ?? null,
    activeParameterCount: activeParameterCount(model),
    trainedContext: model.gguf?.context_length ?? null,
    pipelineTag: model.pipeline_tag ?? null,
    capabilities: capabilitiesFromTags(model.tags ?? []),
    languages: typeof language === "string" ? [language] : (language ?? []),
    license,
    downloads: model.downloads ?? 0,
    likes: model.likes ?? 0,
    tags: model.tags ?? [],
    variants: [],
    policy: repositoryPolicy(model, license),
    provenance: {
      source: "huggingface",
      repository,
      revision: model.sha,
      fetchedAt: new Date().toISOString(),
      freshness,
    },
  }
}

// MoE repositories expose expert counts via config.json (num_experts / num_experts_per_tok),
// not the gguf metadata block. Active parameters are a share of total, not a separate hub field.
function activeParameterCount(model: typeof HubModel.Type) {
  const total = model.gguf?.total
  const experts = model.config?.num_experts
  const activePerToken = model.config?.num_experts_per_tok
  if (!total || !experts || !activePerToken) return null
  return Math.round((total * activePerToken) / experts)
}

// Repository-level facts are known before any variant is resolved, so search results and
// unresolved candidates can still report why they would be blocked.
function repositoryPolicy(model: typeof HubModel.Type, license: string | null): ModelPolicy {
  const reasons: string[] = []
  if (model.private) reasons.push("repository is private")
  if (model.gated) reasons.push("repository requires Hugging Face gated access approval")
  if (model.disabled) reasons.push("repository is disabled")
  if (!hasGGUF(model)) reasons.push("no supported model format (GGUF) found")
  if (!license) reasons.push("license is unavailable")
  return {
    allowed: !model.private && !model.gated && !model.disabled && hasGGUF(model),
    reasons,
  }
}

// Shard completeness, artifact sizes, and quantization labels are only known once the
// repository's file tree has been resolved into variants.
function withVariantPolicy(policy: ModelPolicy, variants: readonly ModelVariant[]): ModelPolicy {
  if (variants.length === 0) return policy
  const reasons = [...policy.reasons]
  const incomplete = variants.filter((variant) => !variant.complete)
  if (incomplete.length > 0) reasons.push(`${incomplete.length} of ${variants.length} shard set(s) are incomplete`)
  const missingSizes = variants.filter((variant) => variant.totalBytes === null)
  if (missingSizes.length > 0) reasons.push(`${missingSizes.length} variant(s) are missing artifact sizes`)
  const ambiguousQuants = variants.filter((variant) => variant.quantization === null)
  if (ambiguousQuants.length > 0)
    reasons.push(`${ambiguousQuants.length} variant(s) have an unrecognized quantization label`)
  const hasCompleteVariant = variants.some((variant) => variant.complete)
  if (policy.allowed && !hasCompleteVariant) reasons.push("no complete GGUF artifact set is available")
  return { allowed: policy.allowed && hasCompleteVariant, reasons }
}

function capabilitiesFromTags(tags: readonly string[]) {
  const values = new Set<string>()
  if (tags.some((tag) => tag === "conversational" || tag === "text-generation")) values.add("chat")
  if (tags.some((tag) => tag === "tool-use" || tag === "function-calling")) values.add("tool_use")
  if (tags.some((tag) => tag === "vision" || tag === "image-text-to-text")) values.add("vision")
  if (tags.some((tag) => tag === "audio" || tag === "audio-text-to-text")) values.add("audio")
  return [...values]
}

function tagValue(tags: readonly string[], key: string) {
  return tags.find((tag) => tag.startsWith(`${key}:`))?.slice(key.length + 1)
}

function variantsFromSiblings(
  repository: string,
  revision: string,
  siblings: readonly (typeof Sibling.Type)[],
  endpoint: string,
): ModelVariant[] {
  const files = siblings.filter((file) => file.rfilename.toLowerCase().endsWith(".gguf"))
  const weightFiles = files.filter((file) => !isProjection(file.rfilename))
  // A shared multimodal projector applies to every quantization of the same repository/revision,
  // so it is attached to each variant rather than grouped as its own shard set.
  const projectionArtifacts = files
    .filter((file) => isProjection(file.rfilename))
    .map((file) => toArtifact(file, "projection", repository, revision, endpoint))
    .sort((a, b) => a.path.localeCompare(b.path))
  const groups = Map.groupBy(weightFiles, (file) => shardInfo(file.rfilename).base)
  return [...groups.entries()]
    .map(([base, siblingsForBase]) =>
      toVariant(repository, revision, base, siblingsForBase, projectionArtifacts, endpoint),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}

function toArtifact(
  file: typeof Sibling.Type,
  role: ModelArtifact["role"],
  repository: string,
  revision: string,
  endpoint: string,
): ModelArtifact {
  return {
    path: file.rfilename,
    role,
    size: file.lfs?.size ?? file.size ?? null,
    digest: file.lfs?.sha256 ? `sha256:${file.lfs.sha256}` : null,
    downloadURL: `${endpoint}/${repository}/resolve/${revision}/${encodePath(file.rfilename)}`,
  }
}

function toVariant(
  repository: string,
  revision: string,
  base: string,
  siblings: readonly (typeof Sibling.Type)[],
  projectionArtifacts: readonly ModelArtifact[],
  endpoint: string,
): ModelVariant {
  const shards = siblings.map((file) => shardInfo(file.rfilename))
  const expected = Math.max(...shards.map((file) => file.total))
  const indexes = new Set(shards.map((file) => file.index))
  const complete = expected === siblings.length && [...Array(expected)].every((_, index) => indexes.has(index + 1))
  const weightArtifacts = siblings
    .map((file) => toArtifact(file, "weights", repository, revision, endpoint))
    .sort((a, b) => a.path.localeCompare(b.path))
  const artifacts = [...weightArtifacts, ...projectionArtifacts]
  const sizes = artifacts.map((artifact) => artifact.size)
  return {
    id: `${repository}@${revision}:${base}`,
    repository,
    revision,
    format: "gguf",
    quantization: parseQuantization(base),
    artifacts,
    totalBytes: sizes.every((size) => size !== null) ? sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0) : null,
    complete,
  }
}

function shardInfo(path: string) {
  const match = path.match(/^(.*)-(\d{5})-of-(\d{5})(\.gguf)$/i)
  if (!match) return { base: path, index: 1, total: 1 }
  return {
    base: `${match[1]}${match[4]}`,
    index: Number(match[2]),
    total: Number(match[3]),
  }
}

function parseQuantization(path: string) {
  const stem = path.replace(/\.gguf$/i, "")
  const match = stem.match(/(?:^|[-_.])((?:UD[-_])?(?:IQ|Q|TQ)\d(?:[-_][A-Z0-9]+)*|BF16|F16|F32)$/i)
  return match?.[1]?.replaceAll("-", "_").toUpperCase() ?? null
}

function isProjection(path: string) {
  return /(^|[/_.-])mmproj([/_.-]|$)/i.test(path)
}

function encodeRepository(repository: string) {
  return repository.split("/").map(encodeURIComponent).join("/")
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/")
}
