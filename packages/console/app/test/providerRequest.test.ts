import { describe, expect, test } from "bun:test"
import { fromOpenaiRequest } from "../src/routes/zen/util/provider/openai"

describe("provider request conversion", () => {
  test("preserves array-form OpenAI assistant content", () => {
    expect(
      fromOpenaiRequest({
        model: "gpt-5",
        input: [
          {
            role: "assistant",
            content: [
              { type: "output_text", text: "hello" },
              { type: "output_text", text: " world" },
            ],
          },
          { role: "user", content: "continue" },
        ],
      }).messages,
    ).toEqual([
      { role: "assistant", content: "hello world" },
      { role: "user", content: "continue" },
    ])
  })
})
