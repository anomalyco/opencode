export * as Memory from "./memory"

import { Schema } from "effect"
import similarity from "compute-cosine-similarity"
import { pipeline } from "@huggingface/transformers"

export type MemoryTier = "semantic" | "preference" | "working"

export const MemoryTierSchema = Schema.Literals(["semantic", "preference", "working"])

export const MemoryItem = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  tier: MemoryTierSchema,
  category: Schema.String,
  content: Schema.String,
  confidence: Schema.Number,
  accessCount: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  expiresAt: Schema.optional(Schema.Number),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Personalization.MemoryItem" })

export type MemoryItem = typeof MemoryItem.Type

export interface MemoryRecord extends MemoryItem {
  embedding?: Float32Array
}

export interface ScoredMemory {
  item: MemoryRecord
  score: number
  similarity: number
  temporalScore: number
}

let transformerPipelinePromise: Promise<unknown> | null = null

/**
 * Generates dense vector embeddings using the standard `@huggingface/transformers`
 * local neural model (defaulting to BGE small) with mean pooling and unit L2 normalization.
 */
export async function generateEmbedding(
  text: string,
  modelName: string = "Xenova/bge-small-en-v1.5",
): Promise<Float32Array> {
  if (!transformerPipelinePromise) {
    transformerPipelinePromise = pipeline("feature-extraction", modelName, {
      dtype: "fp32",
    })
  }

  const extractor = (await transformerPipelinePromise) as (
    input: string,
    options?: Record<string, unknown>,
  ) => Promise<{ data: ArrayLike<number> }>

  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  })

  return new Float32Array(output.data)
}

/**
 * Ranks memories by combined semantic similarity and temporal freshness.
 */
export function rankMemories(
  memories: MemoryRecord[],
  queryEmbedding?: Float32Array,
  options?: {
    now?: number
    similarityWeight?: number
    halfLifeDays?: number
    limit?: number
    tier?: MemoryTier
  },
): ScoredMemory[] {
  const now = options?.now ?? Date.now()
  const similarityWeight = options?.similarityWeight ?? 0.75
  const halfLifeDays = options?.tier === "working" ? 2 : options?.halfLifeDays ?? 30
  const lambda = Math.LN2 / Math.max(1, halfLifeDays)
  const limit = options?.limit ?? 10

  const filtered = options?.tier ? memories.filter((m) => m.tier === options.tier) : memories
  const unexpired = filtered.filter((m) => !m.expiresAt || m.expiresAt > now)

  const scored: ScoredMemory[] = unexpired.map((item) => {
    let sim = item.confidence
    if (queryEmbedding && item.embedding) {
      const calc = similarity(Array.from(queryEmbedding), Array.from(item.embedding))
      sim = calc === null || Number.isNaN(calc) ? 0 : Math.max(0, Math.min(1, calc))
    }

    const dtDays = Math.max(0, (now - item.updatedAt) / (1000 * 60 * 60 * 24))
    const temporalScore = Math.exp(-lambda * dtDays)
    const combinedScore = similarityWeight * sim + (1 - similarityWeight) * temporalScore * item.confidence

    return {
      item,
      score: Math.round(combinedScore * 1000) / 1000,
      similarity: Math.round(sim * 1000) / 1000,
      temporalScore: Math.round(temporalScore * 1000) / 1000,
    }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/**
 * Groups and formats retrieved memories into markdown sections for system context injection.
 */
export function formatMemoriesForContext(scored: ScoredMemory[]): string {
  if (scored.length === 0) return ""

  const semantic: string[] = []
  const preference: string[] = []
  const working: string[] = []

  for (const s of scored) {
    const text = s.item.content.trim()
    if (!text) continue
    if (s.item.tier === "semantic") {
      semantic.push(`- ${text}`)
    } else if (s.item.tier === "preference") {
      preference.push(`- ${text}`)
    } else if (s.item.tier === "working") {
      working.push(`- ${text}`)
    }
  }

  const sections: string[] = []

  if (preference.length > 0) {
    sections.push(`DEVELOPER PREFERENCES:\n${preference.join("\n")}`)
  }
  if (semantic.length > 0) {
    sections.push(`PROJECT CONTEXT & DECISIONS:\n${semantic.join("\n")}`)
  }
  if (working.length > 0) {
    sections.push(`ACTIVE WORKING CONTEXT:\n${working.join("\n")}`)
  }

  return sections.join("\n\n")
}
