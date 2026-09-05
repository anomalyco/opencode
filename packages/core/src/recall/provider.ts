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

/**
 * Sprint 4 M6: OpenAI-compatible provider interface.
 * Calls POST {baseURL}/v1/embeddings with `{input: texts[], model}`.
 * Sprint 4 does NOT wire this to 9router or any external service - the default
 * remains HashingProvider. This is plumbing for future providers (Phase 2).
 *
 * To use in production, the caller must:
 *   1. Set OPENCODE_RECALL_EMBEDDING_PROVIDER=openai-compatible
 *   2. Set OPENCODE_RECALL_EMBEDDING_BASE_URL=https://api.openai.com (or compatible)
 *   3. Set OPENCODE_RECALL_EMBEDDING_API_KEY=sk-...
 *   4. Set OPENCODE_RECALL_EMBEDDING_MODEL=text-embedding-3-small
 *   5. Set OPENCODE_RECALL_EMBEDDING_DIM=1536
 */
export function makeOpenAICompatibleProvider(opts: {
  baseURL: string
  apiKey: string
  model: string
  dim: number
}): EmbeddingProvider {
  return {
    id: "openai-compatible",
    dim: opts.dim,
    modelID: opts.model,
    embed: (texts) =>
      Effect.gen(function* () {
        const res = yield* Effect.tryPromise({
          try: async () => {
            const r = await fetch(`${opts.baseURL}/v1/embeddings`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${opts.apiKey}`,
              },
              body: JSON.stringify({ input: texts, model: opts.model }),
            })
            if (!r.ok) {
              // The body is carried out as data, never inside an Error: a
              // rejected request's body routinely echoes the credential that
              // was rejected, and `Effect.orDie` below turns any Error here
              // into a defect that the experimental tool endpoint squashes
              // into its 400 body. Reading it defensively keeps the status —
              // the most useful part — even when the body cannot be read.
              return {
                ok: false as const,
                status: r.status,
                statusText: r.statusText,
                body: await r.text().catch(() => "<unreadable>"),
              }
            }
            const json = (await r.json()) as { data: { embedding: number[]; index: number }[] }
            // Sort by index to preserve input order
            const sorted = json.data.slice().sort((a, b) => a.index - b.index)
            return { ok: true as const, embeddings: sorted.map((d) => Float32Array.from(d.embedding)) }
          },
          // `catch` produces the error VALUE, not an Effect; wrapping it in
          // Effect.fail here would make the failure channel hold an Effect.
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        })
        if (!res.ok) {
          yield* Effect.logError("recall embeddings API rejected the request", {
            status: res.status,
            statusText: res.statusText,
            body: res.body,
          })
          // Status line only — the body stays in the log, see above.
          return yield* Effect.die(
            new Error(`embeddings API returned ${res.status} ${res.statusText}`),
          )
        }
        return res.embeddings
      }).pipe(Effect.orDie),
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export function textHash(text: string): string {
  return fnv1a(text).toString(16).padStart(8, "0")
}
