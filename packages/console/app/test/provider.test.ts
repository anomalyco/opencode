import { describe, expect, test } from "bun:test"
import { buildCostChunk } from "../src/routes/zen/util/provider/provider"

describe("buildCostChunk", () => {
  test("builds a valid OpenAI-compatible chat completion chunk", () => {
    const chunk = buildCostChunk("oa-compat", "0.001", "test-model")
    const data = JSON.parse(chunk.slice("data: ".length))

    expect(data).toMatchObject({
      object: "chat.completion.chunk",
      model: "test-model",
      choices: [],
      cost: "0.001",
    })
    expect(data.id).toStartWith("chatcmpl-")
    expect(data.created).toBeInteger()
  })
})
