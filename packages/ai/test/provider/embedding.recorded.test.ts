import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, Media, type EmbeddingModel, type EmbeddingOptions } from "../../src/effect.js"
import { Cohere, Google, GoogleVertex, OpenAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"

const values = ["The invoice was charged twice.", "Refund the duplicate payment."]

const openai = recordedTests({
  prefix: "openai-embedding",
  provider: "openai",
  protocol: "openai-embeddings",
  requires: ["OPENAI_API_KEY"],
  metadata: { model: "text-embedding-3-small" },
})

const cohere = recordedTests({
  prefix: "cohere-embedding",
  provider: "cohere",
  protocol: "openai-embeddings",
  requires: ["COHERE_API_KEY"],
  metadata: { model: "embed-v4.0" },
})

const google = recordedTests({
  prefix: "google-embedding",
  provider: "google",
  protocol: "google-embed-content",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
})

const vertex = recordedTests({
  prefix: "google-vertex-embedding",
  provider: "google-vertex",
  protocol: "google-vertex-predict-embeddings",
  requires: ["GOOGLE_VERTEX_API_KEY"],
})

const vertexProvider = GoogleVertex.configure({ apiKey: process.env.GOOGLE_VERTEX_API_KEY ?? "fixture" })

const googleProvider = Google.configure({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture" })

describe("Embedding recorded", () => {
  openai.effect("embeds text with requested dimensions", () =>
    assertEmbedding(
      OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY ?? "fixture" }).embedding("text-embedding-3-small"),
    ),
  )

  cohere.effect("embeds text through the compatibility API", () =>
    assertEmbedding(Cohere.configure({ apiKey: process.env.COHERE_API_KEY ?? "fixture" }).embedding("embed-v4.0")),
  )

  google.effect("embeds text through batchEmbedContents", () =>
    assertEmbedding(googleProvider.embedding("gemini-embedding-2")),
  )

  google.effect("embeds an image and text into one vector each", () =>
    Effect.gen(function* () {
      const image = Media.bytes(
        new Uint8Array(
          yield* Effect.promise(() => Bun.file(`${import.meta.dir}/../fixtures/images/edit-source.jpg`).arrayBuffer()),
        ),
        "image/jpeg",
      )
      const response = yield* ai.embedding.generate({
        model: googleProvider.embedding("gemini-embedding-2"),
        values: [image, "A small square image."],
        dimensions: 128,
      })
      expect(response.embeddings).toHaveLength(2)
      for (const vector of response.embeddings) expect(vector).toHaveLength(128)
      expect(response.usage?.inputTokens).toBeGreaterThan(258)
    }),
  )

  google.effect("maps inputType to a task type for gemini-embedding-001", () =>
    Effect.gen(function* () {
      const model = googleProvider.embedding("gemini-embedding-001")
      const query = yield* ai.embedding.generate({ model, values: [values[0]], dimensions: 64, inputType: "query" })
      const document = yield* ai.embedding.generate({
        model,
        values: [values[0]],
        dimensions: 64,
        inputType: "document",
      })
      expect(query.embeddings[0]).toHaveLength(64)
      expect(query.embeddings[0]).not.toEqual(document.embeddings[0])
    }),
  )
})

describe("Google Vertex embedding recorded", () => {
  vertex.effect("embeds text through :predict", () => assertEmbedding(vertexProvider.embedding("text-embedding-005")))

  vertex.effect("embeds gemini-embedding-001 one text per :predict request", () =>
    assertEmbedding(vertexProvider.embedding("gemini-embedding-001")),
  )
})

const assertEmbedding = <Options extends EmbeddingOptions>(model: EmbeddingModel<Options>) =>
  Effect.gen(function* () {
    const response = yield* ai.embedding.generate({ model, values, dimensions: 256, inputType: "document" })
    expect(response.embeddings).toHaveLength(2)
    for (const vector of response.embeddings) expect(vector).toHaveLength(256)
    expect(response.embeddings[0]).not.toEqual(response.embeddings[1])
    expect(response.usage?.inputTokens).toBeGreaterThan(0)
    return response
  })
