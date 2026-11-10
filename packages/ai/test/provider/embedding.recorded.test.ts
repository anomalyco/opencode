import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, type EmbeddingModel, type EmbeddingOptions } from "../../src/effect.js"
import { Cohere, OpenAI } from "../../src/providers.js"
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

describe("Embedding recorded", () => {
  openai.effect("embeds text with requested dimensions", () =>
    assertEmbedding(
      OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY ?? "fixture" }).embedding("text-embedding-3-small"),
    ),
  )

  cohere.effect("embeds text through the compatibility API", () =>
    assertEmbedding(Cohere.configure({ apiKey: process.env.COHERE_API_KEY ?? "fixture" }).embedding("embed-v4.0")),
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
