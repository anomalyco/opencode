import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ai, EmbeddingClient, EmbeddingUsage, Media } from "../src/effect.js"
import { OpenAI, OpenAICompatible } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, type Handler } from "./lib/http.js"

const client = (handler: Handler) => EmbeddingClient.layer.pipe(Layer.provide(dynamicResponse(handler)))
const offline = client(() => Effect.die("an invalid embedding request reached the network"))

const openai = OpenAI.configure({ apiKey: "openai-key" })

describe("Embedding", () => {
  it.effect("sends text values to OpenAI and returns vectors in value order", () =>
    ai.embedding
      .generate({
        model: openai.embedding("text-embedding-3-small"),
        values: ["first", "second"],
        dimensions: 2,
        inputType: "query",
        providerOptions: { user: "user-1" },
      })
      .pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            expect(response.embeddings).toEqual([
              [0.1, 0.2],
              [0.3, 0.4],
            ])
            expect(response.usage).toEqual(new EmbeddingUsage({ inputTokens: 4 }))
            expect(response.providerMetadata).toEqual({
              openai: { model: "text-embedding-3-small", usage: { prompt_tokens: 4, total_tokens: 4 } },
            })
          }),
        ),
        Effect.provide(
          client((input) => {
            expect(input.request.url).toBe("https://api.openai.com/v1/embeddings")
            expect(input.request.headers.authorization).toBe("Bearer openai-key")
            expect(JSON.parse(input.text)).toEqual({
              encoding_format: "float",
              user: "user-1",
              model: "text-embedding-3-small",
              input: ["first", "second"],
              dimensions: 2,
            })
            return Effect.succeed(
              json(input, {
                object: "list",
                model: "text-embedding-3-small",
                data: [
                  { object: "embedding", index: 1, embedding: [0.3, 0.4] },
                  { object: "embedding", index: 0, embedding: [0.1, 0.2] },
                ],
                usage: { prompt_tokens: 4, total_tokens: 4 },
              }),
            )
          }),
        ),
      ),
  )

  it.effect("sends host fields through a custom OpenAI-compatible endpoint and decodes base64 vectors", () =>
    ai.embedding
      .generate({
        model: OpenAICompatible.configure({
          provider: "nvidia",
          apiKey: "nvidia-key",
          baseURL: "https://integrate.api.nvidia.test/v1/",
          http: { body: { truncate: "END" } },
        }).embedding("nvidia/nemotron-3.5-embed-1b"),
        values: ["a document"],
        providerOptions: { input_type: "passage", encoding_format: "base64" },
      })
      .pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            expect(response.embeddings).toEqual([[1, -2]])
            expect(response.usage).toBeUndefined()
            expect(response.providerMetadata).toEqual({ nvidia: {} })
          }),
        ),
        Effect.provide(
          client((input) => {
            expect(input.request.url).toBe("https://integrate.api.nvidia.test/v1/embeddings")
            expect(input.request.headers.authorization).toBe("Bearer nvidia-key")
            expect(JSON.parse(input.text)).toEqual({
              encoding_format: "base64",
              input_type: "passage",
              truncate: "END",
              model: "nvidia/nemotron-3.5-embed-1b",
              input: ["a document"],
            })
            const vector = Buffer.from(new Float32Array([1, -2]).buffer).toString("base64")
            return Effect.succeed(json(input, { data: [{ embedding: vector }] }))
          }),
        ),
      ),
  )

  it.effect("rejects media values before sending them to OpenAI", () =>
    Effect.gen(function* () {
      const error = yield* ai.embedding
        .generate({
          model: openai.embedding("text-embedding-3-small"),
          values: ["caption", Media.bytes(new Uint8Array([1, 2, 3]), "image/png")],
        })
        .pipe(Effect.flip)
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(error.message).toContain("embeds text only")
    }).pipe(Effect.provide(offline)),
  )

  it.effect("rejects an empty value list", () =>
    Effect.gen(function* () {
      const error = yield* ai.embedding
        .generate({ model: openai.embedding("text-embedding-3-small"), values: [] })
        .pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("Embedding values must not be empty")
    }).pipe(Effect.provide(offline)),
  )

  it.effect("fails when the host returns a different number of vectors", () =>
    Effect.gen(function* () {
      const error = yield* ai.embedding
        .generate({ model: openai.embedding("text-embedding-3-small"), values: ["one", "two"] })
        .pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.message).toContain("Expected 2 embeddings, got 1")
    }).pipe(Effect.provide(client((input) => Effect.succeed(json(input, { data: [{ index: 0, embedding: [0.1] }] }))))),
  )
})
