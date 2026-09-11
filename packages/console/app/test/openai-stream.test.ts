import { describe, expect, test } from "bun:test"
import { createStreamPartConverter } from "../src/routes/zen/util/provider/provider"

describe("OpenAI Responses stream conversion", () => {
  test("terminates completed text responses in Chat Completions format", () => {
    const convert = createStreamPartConverter("openai", "oa-compat")
    const result = convert(
      'event: response.completed\ndata: {"response":{"id":"resp_1","model":"muse-spark-1.2","status":"completed","output":[{"type":"message"}],"usage":{"input_tokens":4,"output_tokens":2}}}',
    )
    const [chunk, done] = result.split("\n\n")

    expect(done).toBe("data: [DONE]")
    expect(JSON.parse(chunk.slice(6))).toMatchObject({
      id: "resp_1",
      model: "muse-spark-1.2",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    })
  })

  test("uses tool_calls when the completed response contains a function call", () => {
    const convert = createStreamPartConverter("openai", "oa-compat")
    const result = convert(
      'event: response.completed\ndata: {"response":{"id":"resp_2","model":"muse-spark-1.2","status":"completed","output":[{"type":"function_call"}]}}',
    )
    const [chunk] = result.split("\n\n")

    expect(JSON.parse(chunk.slice(6)).choices[0].finish_reason).toBe("tool_calls")
  })

  test("does not terminate non-completion events", () => {
    const convert = createStreamPartConverter("openai", "oa-compat")
    const result = convert(
      'event: response.output_text.done\ndata: {"response":{"id":"resp_3","model":"muse-spark-1.2"}}',
    )

    expect(result).not.toContain("data: [DONE]")
    expect(JSON.parse(result.slice(6)).choices).toEqual([])
  })
})
