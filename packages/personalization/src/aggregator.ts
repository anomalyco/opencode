export * as Aggregator from "./aggregator"

import type { UserProfileData } from "./profile"
import { formatProfileDirectives } from "./profile"
import type { MemoryRecord, ScoredMemory } from "./memory"
import { rankMemories, formatMemoriesForContext } from "./memory"
import similarity from "compute-cosine-similarity"

export interface AttentionScoredPreference {
  memory: MemoryRecord
  weight: number
  similarity: number
}

/**
 * Computes PPlug-style soft-attention weights across historical preference embeddings
 * conditioned on the current task query embedding:
 *
 *   w_i = exp(x_u^T h_i / tau) / sum(exp(x_u^T h_k / tau))
 */
export function computeInputAwareAttention(
  queryEmbedding: Float32Array,
  preferenceMemories: MemoryRecord[],
  temperature: number = 0.5,
): AttentionScoredPreference[] {
  if (preferenceMemories.length === 0) return []

  const validItems = preferenceMemories.filter((m) => m.embedding && m.embedding.length === queryEmbedding.length)
  if (validItems.length === 0) {
    const uniform = 1 / preferenceMemories.length
    return preferenceMemories.map((m) => ({
      memory: m,
      weight: uniform,
      similarity: 0,
    }))
  }

  const queryArr = Array.from(queryEmbedding)
  const similarities = validItems.map((item) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const calc = similarity(queryArr, Array.from(item.embedding!))
    const sim = calc === null || Number.isNaN(calc) ? 0 : Math.max(0, Math.min(1, calc))
    return { item, sim }
  })

  // Safe softmax with max subtraction for numerical stability
  const tau = Math.max(0.01, temperature)
  const maxScaled = Math.max(...similarities.map((s) => s.sim / tau))
  const expValues = similarities.map((s) => Math.exp(s.sim / tau - maxScaled))
  const sumExp = expValues.reduce((sum, val) => sum + val, 0)

  return similarities.map((s, idx) => ({
    memory: s.item,
    weight: sumExp > 0 ? (expValues[idx] ?? 0) / sumExp : 1 / similarities.length,
    similarity: s.sim,
  }))
}

export interface PersonalizationContextOptions {
  profile?: UserProfileData
  memories?: MemoryRecord[]
  queryEmbedding?: Float32Array
  topKPreferences?: number
  topKSemantic?: number
  tokenBudgetEstimate?: number
}

/**
 * Builds the complete, dynamically adapted personalization system prompt section
 * blending the developer profile, PPlug-weighted preference memories, and semantic facts.
 */
export function buildPersonalizationContext(options: PersonalizationContextOptions): string {
  const sections: string[] = []

  // 1. Profile behavioral dimensions
  if (options.profile) {
    const profileDirectives = formatProfileDirectives(options.profile)
    if (profileDirectives) {
      sections.push(`DEVELOPER PROFILE & CONVENTIONS:\n${profileDirectives}`)
    }
  }

  // 2. Memory items (semantic, preference, working)
  if (options.memories && options.memories.length > 0) {
    const scoredMemories: ScoredMemory[] = []

    // If query embedding is provided, run PPlug-inspired attention weighting on preference memory
    if (options.queryEmbedding) {
      const prefItems = options.memories.filter((m) => m.tier === "preference")
      const attentionRanked = computeInputAwareAttention(options.queryEmbedding, prefItems)
      attentionRanked.sort((a, b) => b.weight - a.weight)

      const topPrefs = attentionRanked.slice(0, options.topKPreferences ?? 4)
      for (const p of topPrefs) {
        scoredMemories.push({
          item: p.memory,
          score: p.weight,
          similarity: p.similarity,
          temporalScore: 1.0,
        })
      }

      // Add semantic & working memories ranked by cosine similarity + recency
      const nonPrefItems = options.memories.filter((m) => m.tier !== "preference")
      const rankedNonPref = rankMemories(nonPrefItems, options.queryEmbedding, {
        limit: options.topKSemantic ?? 4,
      })
      scoredMemories.push(...rankedNonPref)
    } else {
      // Fallback without query embedding: rank by confidence & recency
      const ranked = rankMemories(options.memories, undefined, {
        limit: (options.topKPreferences ?? 4) + (options.topKSemantic ?? 4),
      })
      scoredMemories.push(...ranked)
    }

    const formattedMemories = formatMemoriesForContext(scoredMemories)
    if (formattedMemories) {
      sections.push(formattedMemories)
    }
  }

  if (sections.length === 0) return ""

  return `
=== PERSONALIZED DEVELOPER CONTEXT (PPlug Engine) ===
${sections.join("\n\n")}
*Note: Repository rules (AGENTS.md) and explicit task requirements always take precedence over these personal preferences.*
=====================================================
  `.trim()
}
