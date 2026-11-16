import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ai, EmbeddingClient, EmbeddingUsage, Media } from "../src/effect.js"
import { Google, GoogleVertex, OpenAI, OpenAICompatible } from "../src/providers.js"
import { embeddingModel as googleEmbeddingModel } from "../src/providers/google.js"
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

  it.effect("batches Google values as one content each and maps inputType to taskType", () =>
    ai.embedding
      .generate({
        model: Google.configure({ apiKey: "google-key" }).embedding("gemini-embedding-2"),
        values: ["a caption", Media.base64("iVBORw0KGgo=", "image/png")],
        dimensions: 256,
        inputType: "document",
        providerOptions: { title: "Restroom" },
      })
      .pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            expect(response.embeddings).toEqual([
              [0.1, 0.2],
              [0.3, 0.4],
            ])
            expect(response.usage).toEqual(new EmbeddingUsage({ inputTokens: 260 }))
            expect(response.providerMetadata).toEqual({ google: { usageMetadata: { promptTokenCount: 260 } } })
          }),
        ),
        Effect.provide(
          client((input) => {
            expect(input.request.url).toBe(
              "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
            )
            expect(input.request.headers["x-goog-api-key"]).toBe("google-key")
            const fields = { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 256, title: "Restroom" }
            expect(JSON.parse(input.text)).toEqual({
              requests: [
                { model: "models/gemini-embedding-2", content: { parts: [{ text: "a caption" }] }, ...fields },
                {
                  model: "models/gemini-embedding-2",
                  content: { parts: [{ inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }] },
                  ...fields,
                },
              ],
            })
            return Effect.succeed(
              json(input, {
                embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
                usageMetadata: { promptTokenCount: 260 },
              }),
            )
          }),
        ),
      ),
  )

  it.effect("lets a Google taskType option replace the inputType mapping and sends settings", () =>
    ai.embedding
      .generate({
        model: googleEmbeddingModel("gemini-embedding-001", {
          apiKey: "google-key",
          headers: { "x-test": "yes" },
          body: { extra: true },
        }),
        values: ["query"],
        inputType: "query",
        providerOptions: { taskType: "CODE_RETRIEVAL_QUERY" },
      })
      .pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            expect(response.usage).toBeUndefined()
            expect(response.providerMetadata).toEqual({ google: {} })
          }),
        ),
        Effect.provide(
          client((input) => {
            expect(input.request.headers["x-test"]).toBe("yes")
            expect(JSON.parse(input.text)).toEqual({
              requests: [
                {
                  model: "models/gemini-embedding-001",
                  content: { parts: [{ text: "query" }] },
                  taskType: "CODE_RETRIEVAL_QUERY",
                },
              ],
              extra: true,
            })
            return Effect.succeed(json(input, { embeddings: [{ values: [1] }] }))
          }),
        ),
      ),
  )

  it.effect("splits more than 100 Google values across batches and joins them in order", () =>
    Effect.gen(function* () {
      const sizes: Array<number> = []
      const response = yield* ai.embedding
        .generate({
          model: Google.configure({ apiKey: "google-key" }).embedding("gemini-embedding-2"),
          values: Array.from({ length: 105 }, (_, index) => `${index}`),
        })
        .pipe(
          Effect.provide(
            client((input) => {
              const requests: Array<{ content: { parts: Array<{ text: string }> } }> = JSON.parse(input.text).requests
              sizes.push(requests.length)
              return Effect.succeed(
                json(input, {
                  embeddings: requests.map((request) => ({ values: [Number(request.content.parts[0].text)] })),
                  usageMetadata: { promptTokenCount: requests.length },
                }),
              )
            }),
          ),
        )
      expect(sizes.toSorted((a, b) => a - b)).toEqual([5, 100])
      expect(response.embeddings).toEqual(Array.from({ length: 105 }, (_, index) => [index]))
      expect(response.usage).toEqual(new EmbeddingUsage({ inputTokens: 105 }))
      expect(response.providerMetadata).toEqual({
        google: {
          responses: [{ usageMetadata: { promptTokenCount: 100 } }, { usageMetadata: { promptTokenCount: 5 } }],
        },
      })
    }),
  )

  it.effect("sends one Vertex embedContent request per value with embedContentConfig", () =>
    Effect.gen(function* () {
      const bodies: Array<unknown> = []
      const response = yield* ai.embedding
        .generate({
          model: GoogleVertex.configure({ accessToken: "vertex-token", project: "proj", location: "us" }).embedding(
            "gemini-embedding-2",
          ),
          values: ["first", Media.base64("JVBERi0=", "application/pdf")],
          dimensions: 128,
          providerOptions: { documentOcr: true },
        })
        .pipe(
          Effect.provide(
            client((input) => {
              expect(input.request.url).toBe(
                "https://aiplatform.us.rep.googleapis.com/v1beta1/projects/proj/locations/us/publishers/google/models/gemini-embedding-2:embedContent",
              )
              expect(input.request.headers.authorization).toBe("Bearer vertex-token")
              const body = JSON.parse(input.text)
              bodies.push(body)
              return Effect.succeed(
                json(input, {
                  embedding: { values: ["text" in body.content.parts[0] ? 1 : 2] },
                  usageMetadata: { promptTokenCount: 3 },
                  truncated: false,
                }),
              )
            }),
          ),
        )
      expect(bodies).toContainEqual({
        content: { parts: [{ text: "first" }] },
        embedContentConfig: { outputDimensionality: 128, documentOcr: true },
      })
      expect(bodies).toContainEqual({
        content: { parts: [{ inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } }] },
        embedContentConfig: { outputDimensionality: 128, documentOcr: true },
      })
      expect(response.embeddings).toEqual([[1], [2]])
      expect(response.usage).toEqual(new EmbeddingUsage({ inputTokens: 6 }))
      expect(response.providerMetadata).toEqual({
        vertex: {
          responses: [
            { usageMetadata: { promptTokenCount: 3 }, truncated: false },
            { usageMetadata: { promptTokenCount: 3 }, truncated: false },
          ],
        },
      })
    }),
  )

  test("rejects Vertex Express Mode keys for embedContent", () => {
    expect(() => GoogleVertex.configure({ apiKey: "vertex-key" }).embedding("gemini-embedding-2")).toThrow(
      "does not support Express Mode API keys",
    )
  })

  it.effect("sends Vertex text embedding models through :predict with instances and parameters", () =>
    ai.embedding
      .generate({
        model: GoogleVertex.configure({ apiKey: "vertex-key" }).embedding("text-embedding-005"),
        values: ["first", "second"],
        dimensions: 256,
        inputType: "query",
        providerOptions: { title: "Docs", autoTruncate: false },
      })
      .pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            expect(response.embeddings).toEqual([[0.1], [0.2]])
            expect(response.usage).toEqual(new EmbeddingUsage({ inputTokens: 5 }))
            expect(response.providerMetadata).toEqual({
              vertex: {
                statistics: [
                  { token_count: 2, truncated: false },
                  { token_count: 3, truncated: false },
                ],
                metadata: { billableCharacterCount: 11 },
              },
            })
          }),
        ),
        Effect.provide(
          client((input) => {
            expect(input.request.url).toBe(
              "https://aiplatform.googleapis.com/v1/publishers/google/models/text-embedding-005:predict",
            )
            expect(input.request.headers["x-goog-api-key"]).toBe("vertex-key")
            expect(JSON.parse(input.text)).toEqual({
              instances: [
                { content: "first", task_type: "RETRIEVAL_QUERY", title: "Docs" },
                { content: "second", task_type: "RETRIEVAL_QUERY", title: "Docs" },
              ],
              parameters: { outputDimensionality: 256, autoTruncate: false },
            })
            return Effect.succeed(
              json(input, {
                predictions: [
                  { embeddings: { values: [0.1], statistics: { token_count: 2, truncated: false } } },
                  { embeddings: { values: [0.2], statistics: { token_count: 3, truncated: false } } },
                ],
                metadata: { billableCharacterCount: 11 },
              }),
            )
          }),
        ),
      ),
  )

  it.effect("sends gemini-embedding-001 on Vertex one text per :predict request", () =>
    Effect.gen(function* () {
      const sent: Array<string> = []
      const response = yield* ai.embedding
        .generate({
          model: GoogleVertex.configure({ apiKey: "vertex-key" }).embedding("gemini-embedding-001"),
          values: ["0", "1", "2"],
          providerOptions: { taskType: "CLUSTERING" },
        })
        .pipe(
          Effect.provide(
            client((input) => {
              const body = JSON.parse(input.text)
              expect(body.instances).toHaveLength(1)
              expect(body.instances[0].task_type).toBe("CLUSTERING")
              expect(body.parameters).toBeUndefined()
              sent.push(body.instances[0].content)
              return Effect.succeed(
                json(input, {
                  predictions: [{ embeddings: { values: [Number(body.instances[0].content)] } }],
                }),
              )
            }),
          ),
        )
      expect(sent.toSorted()).toEqual(["0", "1", "2"])
      expect(response.embeddings).toEqual([[0], [1], [2]])
      expect(response.usage).toBeUndefined()
    }),
  )

  it.effect("splits more than 250 Vertex :predict values", () =>
    Effect.gen(function* () {
      const sizes: Array<number> = []
      const response = yield* ai.embedding
        .generate({
          model: GoogleVertex.configure({ apiKey: "vertex-key" }).embedding("text-multilingual-embedding-002"),
          values: Array.from({ length: 251 }, (_, index) => `${index}`),
        })
        .pipe(
          Effect.provide(
            client((input) => {
              const instances: Array<{ content: string }> = JSON.parse(input.text).instances
              sizes.push(instances.length)
              return Effect.succeed(
                json(input, {
                  predictions: instances.map((instance) => ({ embeddings: { values: [Number(instance.content)] } })),
                }),
              )
            }),
          ),
        )
      expect(sizes.toSorted((a, b) => a - b)).toEqual([1, 250])
      expect(response.embeddings).toEqual(Array.from({ length: 251 }, (_, index) => [index]))
    }),
  )

  it.effect("rejects media values before sending them to Vertex :predict", () =>
    Effect.gen(function* () {
      const error = yield* ai.embedding
        .generate({
          model: GoogleVertex.configure({ apiKey: "vertex-key" }).embedding("text-embedding-005"),
          values: [Media.bytes(new Uint8Array([1, 2, 3]), "image/png")],
        })
        .pipe(Effect.flip)
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(error.message).toContain("embeds text only")
    }).pipe(Effect.provide(offline)),
  )

  it.effect("sends tuned Vertex embedding endpoints through :predict", () =>
    ai.embedding
      .generate({
        model: GoogleVertex.configure({
          accessToken: "vertex-token",
          project: "proj",
          location: "us-central1",
        }).embedding("endpoints/123"),
        values: ["text"],
      })
      .pipe(
        Effect.provide(
          client((input) => {
            expect(input.request.url).toBe(
              "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/proj/locations/us-central1/endpoints/123:predict",
            )
            return Effect.succeed(json(input, { predictions: [{ embeddings: { values: [1] } }] }))
          }),
        ),
      ),
  )
})
