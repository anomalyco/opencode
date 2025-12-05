import { describe, expect, test } from "bun:test"
import { mapOpenAIResponseFinishReason } from "../../src/provider/sdk/openai-compatible/src/responses/map-openai-responses-finish-reason"

describe("mapOpenAIResponseFinishReason", () => {
  test("returns stop when no finish reason and no function call", () => {
    const result = mapOpenAIResponseFinishReason({ finishReason: undefined, hasFunctionCall: false })
    expect(result).toBe("stop")
  })

  test("returns tool-calls when no finish reason but function call seen", () => {
    const result = mapOpenAIResponseFinishReason({ finishReason: undefined, hasFunctionCall: true })
    expect(result).toBe("tool-calls")
  })

  test("returns stop for tool_calls finish with no function calls", () => {
    const result = mapOpenAIResponseFinishReason({ finishReason: "tool_calls", hasFunctionCall: false })
    expect(result).toBe("stop")
  })

  test("returns tool-calls for tool_calls finish when function calls present", () => {
    const result = mapOpenAIResponseFinishReason({ finishReason: "tool_calls", hasFunctionCall: true })
    expect(result).toBe("tool-calls")
  })

  test("returns length for max_output_tokens", () => {
    const result = mapOpenAIResponseFinishReason({ finishReason: "max_output_tokens", hasFunctionCall: false })
    expect(result).toBe("length")
  })

  test("returns content-filter for content_filter", () => {
    const result = mapOpenAIResponseFinishReason({ finishReason: "content_filter", hasFunctionCall: false })
    expect(result).toBe("content-filter")
  })

  test("returns tool-calls for unknown when function calls present", () => {
    const result = mapOpenAIResponseFinishReason({ finishReason: "something", hasFunctionCall: true })
    expect(result).toBe("tool-calls")
  })

  test("returns unknown for unknown when no function calls present", () => {
    const result = mapOpenAIResponseFinishReason({ finishReason: "something", hasFunctionCall: false })
    expect(result).toBe("unknown")
  })
})
