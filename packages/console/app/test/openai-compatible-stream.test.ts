import { describe, expect, test } from "bun:test"
import { createStreamPartConverter } from "../src/routes/zen/util/provider/provider"

describe("OpenAI-compatible stream normalization", () => {
  test("omits null identity fields from tool call continuation deltas", () => {
    const convert = createStreamPartConverter("oa-compat", "oa-compat")
    const result = convert(
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":null,"type":null,"function":{"name":null,"arguments":"{\\"x\\":"}}]}}]}',
    )

    expect(JSON.parse(result.slice(6))).toEqual({
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"x":' } }],
          },
        },
      ],
    })
  })

  test("leaves compliant chunks byte-for-byte unchanged", () => {
    const convert = createStreamPartConverter("oa-compat", "oa-compat")
    const chunk =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}],"provider_extension":true}'

    expect(convert(chunk)).toBe(chunk)
  })

  test("normalizes chunks without a space after the data prefix", () => {
    const convert = createStreamPartConverter("oa-compat", "oa-compat")
    const result = convert(
      'data:{"choices":[{"delta":{"tool_calls":[{"index":0,"id":null,"function":{"name":null}}]}}]}',
    )

    expect(result).toBe('data:{"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}')
  })

  test("passes the done sentinel through unchanged", () => {
    const convert = createStreamPartConverter("oa-compat", "oa-compat")

    expect(convert("data: [DONE]")).toBe("data: [DONE]")
  })

  test("does not leak null identity fields into cross-format continuations", () => {
    const convert = createStreamPartConverter("oa-compat", "anthropic")
    const result = convert(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":null,"type":null,"function":{"name":null,"arguments":"{"}}]}}]}',
    )

    expect(JSON.parse(result)).toEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: "{" },
    })
  })
})
