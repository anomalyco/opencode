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
})
