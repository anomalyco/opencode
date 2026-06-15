import { describe, expect, test } from "bun:test"
import { fromAnthropicRequest } from "../src/routes/zen/util/provider/anthropic"
import { toOaCompatibleRequest } from "../src/routes/zen/util/provider/openai-compatible"

describe("anthropic to oa-compat tool conversion", () => {
  test("preserves tool names from Claude Code style anthropic requests", () => {
    const anthropicBody = {
      model: "deepseek-v4-flash-free",
      max_tokens: 1024,
      tools: [
        {
          name: "Bash",
          description: "Run a bash command",
          input_schema: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      ],
      messages: [{ role: "user", content: "run echo hello" }],
    }

    const common = fromAnthropicRequest(anthropicBody)
    const oaCompat = toOaCompatibleRequest(common)

    expect(oaCompat.tools).toEqual([
      {
        type: "function",
        function: {
          name: "Bash",
          description: "Run a bash command",
          parameters: anthropicBody.tools[0].input_schema,
        },
      },
    ])
  })

  test("passes through already-normalized common request tools", () => {
    const common = {
      model: "north-mini-code-free",
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [
        {
          type: "function" as const,
          function: {
            name: "Read",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        },
      ],
    }

    const oaCompat = toOaCompatibleRequest(common)

    expect(oaCompat.tools?.[0]?.function?.name).toBe("Read")
  })
})
