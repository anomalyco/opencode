import { describe, expect, test } from "bun:test"
import { fromOpenaiRequest } from "../src/routes/zen/util/provider/openai"
import { toOaCompatibleRequest } from "../src/routes/zen/util/provider/openai-compatible"

describe("fromOpenaiRequest assistant content", () => {
  test("flattens array-format assistant content into text", () => {
    const common = fromOpenaiRequest({
      model: "deepseek-v4-flash-free",
      input: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [{ type: "output_text", text: "hello there" }],
        },
      ],
    })

    expect(common.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there" },
    ])
  })

  test("survives the full openai -> oa-compat conversion without dropping the assistant message", () => {
    const common = fromOpenaiRequest({
      model: "deepseek-v4-flash-free",
      stream: true,
      input: [
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
        {
          role: "assistant",
          content: [{ type: "output_text", text: "partial answer" }],
        },
        { role: "user", content: "continue" },
      ],
    })
    const compat = toOaCompatibleRequest(common)

    const assistants = compat.messages.filter((m: any) => m.role === "assistant")
    expect(assistants).toEqual([{ role: "assistant", content: "partial answer" }])
  })

  test("keeps tool_calls when array content is absent", () => {
    const common = fromOpenaiRequest({
      model: "m",
      input: [
        {
          role: "assistant",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }],
        },
      ],
    })
    expect(common.messages[0]).toMatchObject({ role: "assistant" })
    expect((common.messages[0] as any).tool_calls).toHaveLength(1)
    expect((common.messages[0] as any).content).toBeUndefined()
  })
})
