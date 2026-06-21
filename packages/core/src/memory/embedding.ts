/**
 * Centralized embedding service for ZERO.
 *
 * Supports multiple providers:
 *  1. OpenAI / AI SDK embedding models (when OPENAI_API_KEY is set)
 *  2. Hash-based fallback (always available, no deps)
 *
 * Also provides an in-memory vector cache that avoids full-table scans
 * for repeated queries.
 */

/**
 * Compute cosine similarity between two vectors.
 * Vectors must have the same length.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dot / magnitude
}

// ---------------------------------------------------------------------------
// Embedding provider abstraction
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  /** A human-readable name for this provider (e.g. "openai", "hash") */
  readonly name: string
  /** The vector dimensions this provider produces */
  readonly dimensions: number
  /** Embed a single text string. Must never throw — return a zero vector on failure. */
  readonly embed: (text: string) => Promise<number[]>
}

// ---------------------------------------------------------------------------
// Hash-based bag-of-words fallback  (always available)
// ---------------------------------------------------------------------------

function hashWord(word: string): number {
  let hash = 0
  for (let i = 0; i < word.length; i++) {
    hash = (hash << 5) - hash + word.charCodeAt(i)
    hash |= 0
  }
  return hash
}

function generateHashEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array(dimensions).fill(0)
  const words = text.toLowerCase().match(/\w+/g)
  if (!words || words.length === 0) return vector

  for (const word of words) {
    const idx = Math.abs(hashWord(word)) % dimensions
    vector[idx] += 1
  }

  // L2-normalize
  let magnitude = 0
  for (let i = 0; i < dimensions; i++) magnitude += vector[i] * vector[i]
  magnitude = Math.sqrt(magnitude)
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) vector[i] /= magnitude
  }
  return vector
}

export const HashEmbeddingProvider: EmbeddingProvider = {
  name: "hash",
  dimensions: 1536,
  embed: (text: string) => Promise.resolve(generateHashEmbedding(text, 1536)),
}

// ---------------------------------------------------------------------------
// AI SDK embedding provider  (requires OPENAI_API_KEY)
// ---------------------------------------------------------------------------

let _aiSdkProvider: EmbeddingProvider | undefined

function createAiSdkEmbeddingProvider(): EmbeddingProvider {
  // Lazy-import @ai-sdk/openai so that the module loads without errors
  // when the package isn't fully installed.
  let embeddingModel: any = null
  return {
    name: "openai-ai-sdk",
    dimensions: 1536,
    async embed(text: string): Promise<number[]> {
      if (!embeddingModel) {
        try {
          const { openai } = await import("@ai-sdk/openai")
          embeddingModel = openai.embedding("text-embedding-3-small", { dimensions: 1536 })
        } catch {
          // AI SDK not available — fall through to the caller's fallback
          return generateHashEmbedding(text, 1536)
        }
      }
      try {
        const { embeddings } = await embeddingModel.doEmbed({ values: [text] })
        return embeddings[0]
      } catch {
        return generateHashEmbedding(text, 1536)
      }
    },
  }
}

/**
 * Get an embedding provider that tries the AI SDK (OpenAI) first and falls
 * back to the hash-based local embedding.
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  // Try the real AI SDK provider if we have an API key
  if (process.env.OPENAI_API_KEY) {
    if (!_aiSdkProvider) {
      _aiSdkProvider = createAiSdkEmbeddingProvider()
    }
    return _aiSdkProvider
  }
  return HashEmbeddingProvider
}

/**
 * Embed a single text string.
 * Uses the AI SDK (OpenAI) when OPENAI_API_KEY is set, otherwise falls back
 * to a deterministic hash-based local embedding.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const provider = await getEmbeddingProvider()
  return provider.embed(text)
}

// ---------------------------------------------------------------------------
// In-memory vector cache  (avoids full-table scans for repeated queries)
// ---------------------------------------------------------------------------

export interface CachedEntry {
  id: string
  vector: number[]
  payload: Record<string, unknown>
}

export class VectorCache {
  private entries: CachedEntry[] = []
  private dimensions = 0

  /** Replace the entire cache contents (call after loading from DB). */
  load(entries: CachedEntry[]): void {
    this.entries = entries
    this.dimensions = entries.length > 0 ? entries[0].vector.length : 0
  }

  /** Add or replace a single entry. */
  upsert(id: string, vector: number[], payload: Record<string, unknown>): void {
    const idx = this.entries.findIndex((e) => e.id === id)
    if (idx >= 0) {
      this.entries[idx] = { id, vector, payload }
    } else {
      this.entries.push({ id, vector, payload })
    }
    if (this.dimensions === 0) this.dimensions = vector.length
  }

  /** Remove an entry by id. */
  remove(id: string): void {
    const idx = this.entries.findIndex((e) => e.id === id)
    if (idx >= 0) this.entries.splice(idx, 1)
  }

  /** Clear the cache. */
  clear(): void {
    this.entries = []
    this.dimensions = 0
  }

  /**
   * Search the cache for the top-k most similar entries.
   * Returns entries sorted by descending similarity score.
   */
  search(queryVector: number[], k = 5, minScore = 0.1): CachedEntry[] {
    if (this.entries.length === 0) return []

    const scored = this.entries.map((entry) => ({
      score: cosineSimilarity(queryVector, entry.vector),
      entry,
    }))

    return scored
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => s.entry)
  }

  /** Number of entries in the cache. */
  get size(): number {
    return this.entries.length
  }

  /** Return all cached vectors (for batch operations). */
  all(): CachedEntry[] {
    return this.entries
  }
}

/**
 * Parse an embedding stored as a JSON text column.
 * Returns an empty array on parse failure.
 */
export function parseEmbeddingJson(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    return JSON.parse(raw) as number[]
  } catch {
    return []
  }
}
