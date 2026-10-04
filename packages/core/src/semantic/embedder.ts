import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"

export class EmbedderError extends Schema.TaggedErrorClass<EmbedderError>()("SemanticEmbedder.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly isAvailable: () => Effect.Effect<boolean>
  readonly embed: (texts: readonly string[]) => Effect.Effect<readonly (readonly number[])[], EmbedderError>
  readonly embedOne: (text: string) => Effect.Effect<readonly number[], EmbedderError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SemanticEmbedder") {}

export const cosineSimilarity = (a: readonly number[], b: readonly number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!
    const valB = b[i]!
    dotProduct += valA * valB
    normA += valA * valA
    normB += valB * valB
  }
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

const DEFAULT_URL = "http://127.0.0.1:11434"
const DEFAULT_MODEL = "nomic-embed-text"
const TIMEOUT_MS = 3000

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const baseUrl = process.env.OPENCODE_OLLAMA_URL || DEFAULT_URL
    const model = process.env.OPENCODE_EMBED_MODEL || DEFAULT_MODEL

    const isAvailable = () =>
      Effect.tryPromise({
        try: async () => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 1000)
          try {
            const res = await fetch(`${baseUrl}/api/tags`, {
              signal: controller.signal,
              method: "GET",
            })
            if (!res.ok) return false
            const data = (await res.json()) as { models?: { name?: string }[] }
            return (data.models ?? []).some((m) => m.name?.startsWith(model))
          } finally {
            clearTimeout(timer)
          }
        },
        catch: () => false,
      }).pipe(Effect.catch(() => Effect.succeed(false)))

    const embed = (texts: readonly string[]) =>
      Effect.tryPromise({
        try: async () => {
          if (texts.length === 0) return []
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
          try {
            // First attempt native batch embed API (/api/embed)
            const res = await fetch(`${baseUrl}/api/embed`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model, input: texts }),
              signal: controller.signal,
            })
            if (res.ok) {
              const data = (await res.json()) as { embeddings?: number[][] }
              if (data.embeddings && data.embeddings.length === texts.length) {
                return data.embeddings
              }
            }

            // Fallback to sequential /api/embeddings if batch endpoint fails
            const results: number[][] = []
            for (const text of texts) {
              const singleRes = await fetch(`${baseUrl}/api/embeddings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model, prompt: text }),
                signal: controller.signal,
              })
              if (!singleRes.ok) {
                throw new Error(`Embedding request failed with HTTP ${singleRes.status}`)
              }
              const singleData = (await singleRes.json()) as { embedding?: number[] }
              if (!singleData.embedding) {
                throw new Error("No embedding returned from endpoint")
              }
              results.push(singleData.embedding)
            }
            return results
          } finally {
            clearTimeout(timer)
          }
        },
        catch: (cause) =>
          new EmbedderError({
            message: `Failed to generate embeddings from ${baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      })

    const embedOne = (text: string) =>
      embed([text]).pipe(
        Effect.flatMap((results) => {
          const first = results[0]
          if (!first) {
            return Effect.fail(new EmbedderError({ message: "No embedding returned for single input" }))
          }
          return Effect.succeed(first)
        }),
      )

    return Service.of({
      isAvailable,
      embed,
      embedOne,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

export * as SemanticEmbedder from "./embedder"

