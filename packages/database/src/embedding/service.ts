import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

export class EmbeddingError extends Schema.TaggedErrorClass<EmbeddingError>()("EmbeddingError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export const OLLAMA_BASE = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"
export const EMBEDDING_MODEL = "nomic-embed-text"

export interface EmbeddingInterface {
  embed(text: string): Effect.Effect<number[], EmbeddingError>
}

export class EmbeddingService extends Context.Service<EmbeddingService, EmbeddingInterface>()(
  "@opencode-ai/database/EmbeddingService",
) {
  static layer = Layer.effect(
    EmbeddingService,
    Effect.sync(() =>
      EmbeddingService.of({
        embed: Effect.fn("EmbeddingService.embed")(function* (text) {
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${OLLAMA_BASE}/api/embeddings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
              }),
            catch: (cause) => new EmbeddingError({ message: "Ollama request failed", cause }),
          })

          if (!response.ok) {
            return yield* new EmbeddingError({ message: `Ollama returned ${response.status}` })
          }

          const data = yield* Effect.tryPromise({
            try: () => response.json() as Promise<{ embedding: number[] }>,
            catch: (cause) => new EmbeddingError({ message: "Failed to parse Ollama response", cause }),
          })

          return data.embedding
        }),
      }),
    ),
  )
}

export const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

export * as Embedding from "./service"
