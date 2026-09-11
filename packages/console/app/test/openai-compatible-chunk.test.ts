import { describe, expect, test } from "bun:test"
import {
  fromOaCompatibleChunk,
  toOaCompatibleChunk,
} from "../src/routes/zen/util/provider/openai-compatible"
import { toAnthropicChunk } from "../src/routes/zen/util/provider/anthropic"

const payload = {
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "test-model",
  choices: [
    {
      index: 0,
      delta: {
        content: "fox",
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "get_time", arguments: "{}" },
          },
        ],
      },
      finish_reason: null,
    },
  ],
}

describe("OA-compat stream chunks", () => {
  test("keeps tool_calls when a chunk also has content", () => {
    const common = fromOaCompatibleChunk(`data: ${JSON.stringify(payload)}`)
    expect(typeof common).toBe("object")
    if (typeof common === "string") throw new Error("expected parsed chunk")

    expect(common.choices).toHaveLength(1)
    expect(common.choices[0]?.delta.content).toBe("fox")
    expect(common.choices[0]?.delta.tool_calls).toEqual([
      {
        index: 0,
        id: "call_1",
        type: "function",
        function: { name: "get_time", arguments: "{}" },
      },
    ])

    const roundtrip = JSON.parse(toOaCompatibleChunk(common).slice("data: ".length))
    expect(roundtrip.choices).toHaveLength(1)
    expect(roundtrip.choices[0].delta.content).toBe("fox")
    expect(roundtrip.choices[0].delta.tool_calls[0].function.name).toBe("get_time")
  })

  test("preserves tool_calls when converting the mixed chunk to Anthropic", () => {
    const common = fromOaCompatibleChunk(`data: ${JSON.stringify(payload)}`)
    if (typeof common === "string") throw new Error("expected parsed chunk")

    const anthropic = JSON.parse(toAnthropicChunk(common))
    expect(anthropic.type).toBe("content_block_start")
    expect(anthropic.content_block).toMatchObject({ type: "tool_use", id: "call_1", name: "get_time" })
  })
})
