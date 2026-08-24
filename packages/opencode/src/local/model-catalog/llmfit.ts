import { Schema } from "effect"
import type { ModelCandidate, ModelEvidence } from "./types"
import { LLMFIT_SEED_COMMIT } from "./adoption-manifest"

export const LlmfitCapability = Schema.Literals(["vision", "tool_use", "audio", "tts"])
export type LlmfitCapability = typeof LlmfitCapability.Type

export const LlmfitModelFormat = Schema.Literals(["gguf", "awq", "gptq", "autoround", "mlx", "safetensors"])
export type LlmfitModelFormat = typeof LlmfitModelFormat.Type

export const LlmfitSource = Schema.Struct({
  repo: Schema.String,
  provider: Schema.String,
})
export type LlmfitSource = typeof LlmfitSource.Type

export const LlmfitEntry = Schema.Struct({
  name: Schema.String,
  provider: Schema.String,
  parameter_count: Schema.String,
  parameters_raw: Schema.optional(Schema.Number),
  min_ram_gb: Schema.Number,
  recommended_ram_gb: Schema.Number,
  min_vram_gb: Schema.optional(Schema.Number),
  quantization: Schema.String,
  format: LlmfitModelFormat,
  context_length: Schema.Number,
  use_case: Schema.String,
  capabilities: Schema.optional(Schema.Array(LlmfitCapability)),
  languages: Schema.optional(Schema.Array(Schema.String)),
  pipeline_tag: Schema.optional(Schema.String),
  architecture: Schema.optional(Schema.String),
  hf_downloads: Schema.optional(Schema.Number),
  hf_likes: Schema.optional(Schema.Number),
  release_date: Schema.optional(Schema.String),
  is_moe: Schema.optional(Schema.Boolean),
  num_experts: Schema.optional(Schema.Number),
  active_experts: Schema.optional(Schema.Number),
  active_parameters: Schema.optional(Schema.Number),
  num_hidden_layers: Schema.optional(Schema.Number),
  num_attention_heads: Schema.optional(Schema.Number),
  num_key_value_heads: Schema.optional(Schema.Number),
  head_dim: Schema.optional(Schema.Number),
  hidden_size: Schema.optional(Schema.Number),
  vocab_size: Schema.optional(Schema.Number),
  moe_intermediate_size: Schema.optional(Schema.Number),
  shared_expert_intermediate_size: Schema.optional(Schema.Number),
  gguf_sources: Schema.optional(Schema.Array(LlmfitSource)),
  license: Schema.optional(Schema.String),
  attention_layout: Schema.optional(
    Schema.Struct({
      full: Schema.Number,
      linear: Schema.Number,
    }),
  ),
})
export type LlmfitEntry = typeof LlmfitEntry.Type

export type LlmfitSeedModel = {
  repository: string
  name: string
  author: string
  parameterCount: number | null
  activeParameterCount: number | null
  trainedContext: number | null
  pipelineTag: string | null
  capabilities: readonly string[]
  languages: readonly string[]
  license: string | null
  downloads: number
  likes: number
  quantization: string
  format: LlmfitModelFormat
  isMoe: boolean
  numExperts: number | null
  activeExperts: number | null
  hiddenLayers: number | null
  attentionHeads: number | null
  kvHeads: number | null
  headDim: number | null
  hiddenSize: number | null
  vocabSize: number | null
  moeIntermediateSize: number | null
  sharedExpertIntermediateSize: number | null
  minRamGb: number
  recommendedRamGb: number
  minVramGb: number | null
  useCase: string
  releaseDate: string | null
  architecture: string | null
  provenance: string
}

export type LlmfitImportResult = {
  models: LlmfitSeedModel[]
  evidence: ModelEvidence[]
}

export function importLlmfitSeed(entries: readonly unknown[]): LlmfitImportResult {
  const decoded = Schema.decodeUnknownSync(Schema.Array(LlmfitEntry))(entries)
  const seen = new Set<string>()
  const models: LlmfitSeedModel[] = []
  const evidence: ModelEvidence[] = []

  for (const entry of decoded) {
    const repository = entry.name
    if (seen.has(repository)) continue
    seen.add(repository)

    const name = repository.split("/").at(-1) ?? repository
    const author = entry.provider ?? repository.split("/")[0] ?? null
    const parameterCount = entry.parameters_raw ?? null
    const activeParameterCount = entry.active_parameters ?? null
    const trainedContext = entry.context_length ?? null
    const pipelineTag = entry.pipeline_tag ?? null
    const capabilities = entry.capabilities ?? []
    const languages = entry.languages ?? []
    const license = entry.license ?? null
    const downloads = entry.hf_downloads ?? 0
    const likes = entry.hf_likes ?? 0
    const quantization = entry.quantization
    const format = entry.format
    const isMoe = entry.is_moe ?? false
    const numExperts = entry.num_experts ?? null
    const activeExperts = entry.active_experts ?? null
    const hiddenLayers = entry.num_hidden_layers ?? null
    const attentionHeads = entry.num_attention_heads ?? null
    const kvHeads = entry.num_key_value_heads ?? null
    const headDim = entry.head_dim ?? null
    const hiddenSize = entry.hidden_size ?? null
    const vocabSize = entry.vocab_size ?? null
    const moeIntermediateSize = entry.moe_intermediate_size ?? null
    const sharedExpertIntermediateSize = entry.shared_expert_intermediate_size ?? null
    const minRamGb = entry.min_ram_gb
    const recommendedRamGb = entry.recommended_ram_gb
    const minVramGb = entry.min_vram_gb ?? null
    const useCase = entry.use_case
    const releaseDate = entry.release_date ?? null
    const architecture = entry.architecture ?? null

    models.push({
      repository,
      name,
      author,
      parameterCount,
      activeParameterCount,
      trainedContext,
      pipelineTag,
      capabilities,
      languages,
      license,
      downloads,
      likes,
      quantization,
      format,
      isMoe,
      numExperts,
      activeExperts,
      hiddenLayers,
      attentionHeads,
      kvHeads,
      headDim,
      hiddenSize,
      vocabSize,
      moeIntermediateSize,
      sharedExpertIntermediateSize,
      minRamGb,
      recommendedRamGb,
      minVramGb,
      useCase,
      releaseDate,
      architecture,
      provenance: `llmfit@${LLMFIT_SEED_COMMIT}`,
    })
  }

  // Emit sorted deterministically by repository ID.
  models.sort((a, b) => a.repository.localeCompare(b.repository))

  // Emit quality evidence from llmfit catalog for each model.
  for (const model of models) {
    if (model.parameterCount !== null) {
      evidence.push({
        kind: "quality",
        source: "llmfit",
        measured: false,
        value: { repository: model.repository, parameterCount: model.parameterCount, quantization: model.quantization },
      })
    }
    if (model.minRamGb !== null) {
      evidence.push({
        kind: "quality",
        source: "llmfit",
        measured: false,
        value: { repository: model.repository, minRamGb: model.minRamGb, recommendedRamGb: model.recommendedRamGb },
      })
    }
    if (model.trainedContext !== null) {
      evidence.push({
        kind: "context",
        source: "llmfit",
        measured: false,
        value: { repository: model.repository, contextLength: model.trainedContext },
      })
    }
  }

  return { models, evidence }
}

export function toModelCandidate(model: LlmfitSeedModel): ModelCandidate {
  return {
    id: model.repository,
    name: model.name,
    author: model.author,
    repository: model.repository,
    revision: null,
    architecture: model.architecture,
    parameterCount: model.parameterCount,
    activeParameterCount: model.activeParameterCount,
    trainedContext: model.trainedContext,
    pipelineTag: model.pipelineTag,
    capabilities: [...model.capabilities],
    languages: [...model.languages],
    license: model.license,
    downloads: model.downloads,
    likes: model.likes,
    tags: [model.format, model.quantization],
    variants: [],
    provenance: {
      source: "seed",
      repository: model.repository,
      freshness: "seed",
    },
    policy: {
      allowed: model.format === "gguf",
      reasons: model.format !== "gguf" ? [`unsupported format: ${model.format}`] : [],
    },
  }
}
