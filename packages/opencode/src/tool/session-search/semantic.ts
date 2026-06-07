import { Config } from "@/config/config"
import { Context, Duration, Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Hash } from "@opencode-ai/core/util/hash"
import * as Log from "@opencode-ai/core/util/log"
import { Service as EmbeddingCacheService } from "./embedding-cache"
import type { LexicalMatch } from "./lexical"

const log = Log.create({ service: "semantic-search" })
const BATCH_SIZE = 64

export interface SemanticMatch {
  sessionId: string
  messageId: string
  content: string
  score: number
}

export type SemanticSearchError =
  | { _tag: "JinaApiError"; status: number; message: string }
  | { _tag: "JinaTimeout"; timeoutMs: number }
  | { _tag: "EmbeddingCacheError"; cause: unknown }

export interface Interface {
  readonly search: (input: {
    query: string
    candidates: LexicalMatch[]
    limit: number
  }) => Effect.Effect<SemanticMatch[], SemanticSearchError>
  readonly isAvailable: () => Effect.Effect<boolean>
}

export class SemanticSearch extends Context.Service<SemanticSearch, Interface>()("@opencode/SemanticSearch") {}

export const layer: Layer.Layer<
  SemanticSearch,
  never,
  Config.Service | EmbeddingCacheService | HttpClient.HttpClient
> = Layer.effect(
  SemanticSearch,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const cache = yield* EmbeddingCacheService
    const http = yield* HttpClient.HttpClient

    const getConfig = () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const sc = cfg.session_search
        const apiKey = sc?.jina_api_key || process.env.OPENCODE_JINA_API_KEY
        const semanticEnabled = sc?.semantic_enabled
        const model = sc?.semantic_model ?? "jina-embeddings-v5-text-small"
        const endpoint = sc?.semantic_endpoint ?? "https://api.jina.ai/v1/embeddings"
        const timeoutMs = sc?.semantic_request_timeout_ms ?? 30000
        return { apiKey, semanticEnabled, model, endpoint, timeoutMs }
      })

    const isAvailable = Effect.fn("SemanticSearch.isAvailable")(function* () {
      const { apiKey, semanticEnabled } = yield* getConfig()
      if (!apiKey) return false
      if (semanticEnabled === false) return false
      return true
    })

    const search = Effect.fn("SemanticSearch.search")(function* (input: {
      query: string
      candidates: LexicalMatch[]
      limit: number
    }) {
      if (input.candidates.length === 0) return []

      const { apiKey, model, endpoint, timeoutMs } = yield* getConfig()
      if (!apiKey) return []

      const unique = deduplicateCandidates(input.candidates)

      const queryEmbeddings = yield* embedTexts({
        texts: [input.query],
        model,
        endpoint,
        apiKey,
        task: "retrieval.query",
        timeoutMs,
        http,
      }).pipe(
        Effect.tapError((err) =>
          Effect.sync(() => log.warn("failed to embed query", { model, errorTag: err._tag })),
        ),
      )

      const queryVec = queryEmbeddings[0]
      if (!queryVec) return []

      const fingerprints = unique.map((c) => Hash.sha256(c.content))
      const cachedVectors = new Map<number, Float32Array>()
      const missIndices: number[] = []

      for (let i = 0; i < unique.length; i++) {
        const cached = yield* cache.get(fingerprints[i], model)
        if (Option.isSome(cached)) {
          cachedVectors.set(i, cached.value)
          continue
        }
        missIndices.push(i)
      }

      if (missIndices.length > 0) {
        for (let b = 0; b < missIndices.length; b += BATCH_SIZE) {
          const batchIndices = missIndices.slice(b, b + BATCH_SIZE)
          const batchTexts = batchIndices.map((i) => unique[i].content)

          const embeddings = yield* embedTexts({
            texts: batchTexts,
            model,
            endpoint,
            apiKey,
            task: "retrieval.passage",
            timeoutMs,
            http,
          }).pipe(
            Effect.tapError((err) =>
              Effect.sync(() =>
                log.warn("failed to embed passages", {
                  model,
                  batchStart: b,
                  batchSize: batchTexts.length,
                  errorTag: err._tag,
                }),
              ),
            ),
          )

          for (let j = 0; j < batchTexts.length; j++) {
            const vec = embeddings[j]
            const idx = batchIndices[j]
            if (!vec) continue
            cachedVectors.set(idx, vec)
            yield* cache.set(fingerprints[idx], Array.from(vec), vec.length, model)
          }
        }
      }

      const scored = unique
        .map((candidate, i) => {
          const vec = cachedVectors.get(i)
          if (!vec) return undefined
          return { candidate, score: cosineSimilarity(queryVec, vec) }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)

      scored.sort((a, b) => b.score - a.score)

      return scored.slice(0, input.limit).map((entry) => ({
        sessionId: entry.candidate.sessionId,
        messageId: entry.candidate.messageId,
        content: entry.candidate.content,
        score: entry.score,
      }))
    })

    return SemanticSearch.of({ search, isAvailable })
  }),
)

function deduplicateCandidates(candidates: LexicalMatch[]): LexicalMatch[] {
  const seen = new Set<string>()
  const unique: LexicalMatch[] = []
  for (const c of candidates) {
    if (!seen.has(c.content)) {
      seen.add(c.content)
      unique.push(c)
    }
  }
  return unique
}

// --- Helpers ---

interface EmbedRequest {
  texts: string[]
  model: string
  endpoint: string
  apiKey: string
  task: "retrieval.query" | "retrieval.passage"
  timeoutMs: number
  http: HttpClient.HttpClient
}

interface JinaEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>
  model: string
}

function embedTexts(request: EmbedRequest): Effect.Effect<Float32Array[], SemanticSearchError> {
  return Effect.gen(function* () {
    const req = yield* HttpClientRequest.post(request.endpoint).pipe(
      HttpClientRequest.setHeader("Authorization", `Bearer ${request.apiKey}`),
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.bodyJson({
        model: request.model,
        task: request.task,
        input: request.texts,
      }),
      Effect.mapError((): SemanticSearchError => ({
        _tag: "JinaApiError",
        status: 0,
        message: "Failed to build Jina API request body",
      })),
    )

    const response = yield* request.http.execute(req).pipe(
      Effect.timeout(Duration.millis(request.timeoutMs)),
      Effect.mapError((): SemanticSearchError => ({ _tag: "JinaTimeout", timeoutMs: request.timeoutMs })),
    )

    const status = response.status
    if (status < 200 || status >= 300) {
      return yield* Effect.fail<SemanticSearchError>({
        _tag: "JinaApiError",
        status,
        message: sanitizeErrorMessage(`Jina API returned status ${status}`),
      })
    }

    const body = yield* response.json.pipe(
      Effect.mapError((): SemanticSearchError => ({
        _tag: "JinaApiError",
        status: 0,
        message: "Failed to parse Jina API response body",
      })),
    )

    const parsed = body as unknown as JinaEmbeddingResponse | undefined
    const data = parsed?.data
    if (!data || !Array.isArray(data)) {
      return yield* Effect.fail<SemanticSearchError>({
        _tag: "JinaApiError",
        status,
        message: "Invalid Jina API response format",
      })
    }

    const sorted = [...data].sort((a, b) => a.index - b.index)
    return sorted.map((entry) => new Float32Array(entry.embedding))
  })
}

function sanitizeErrorMessage(message: string): string {
  const maxLen = 200
  return message.length > maxLen ? message.slice(0, maxLen) + "..." : message
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}
