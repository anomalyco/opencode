import { Effect } from "effect"

export interface EmbeddingProvider {
  /** Stable identifier stored per row so stale vectors are detectable after a provider swap. */
  readonly id: string
  readonly dim: number
  readonly modelID: string
  readonly embed: (texts: string[]) => Effect.Effect<Float32Array[]>
}

const DIM = 256

function fnv1a(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function normalize(vec: Float32Array) {
  let sum = 0
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i]
  const norm = Math.sqrt(sum)
  if (norm === 0) return
  for (let i = 0; i < vec.length; i++) vec[i] /= norm
}

/**
 * Deterministic bag-of-character-trigrams embedding. Zero dependencies and no
 * network — plumbing-first quality that validates the index/retrieval path.
 * Real semantic providers plug in behind the same interface.
 */
export const HashingProvider: EmbeddingProvider = {
  id: "hashing",
  dim: DIM,
  modelID: "char-trigram-v1",
  embed: (texts) =>
    Effect.sync(() =>
      texts.map((text) => {
        const vec = new Float32Array(DIM)
        const flat = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `
        for (let i = 0; i + 3 <= flat.length; i++) {
          vec[fnv1a(flat.slice(i, i + 3)) % DIM] += 1
        }
        normalize(vec)
        return vec
      }),
    ),
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export function textHash(text: string): string {
  return fnv1a(text).toString(16).padStart(8, "0")
}
