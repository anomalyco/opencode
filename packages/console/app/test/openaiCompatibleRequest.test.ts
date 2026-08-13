import { describe, expect, test } from "bun:test"
import { fromOpenaiRequest } from "../src/routes/zen/util/provider/openai"
import { toOaCompatibleRequest } from "../src/routes/zen/util/provider/openai-compatible"

describe("toOaCompatibleRequest tool conversion", () => {
  test("drops non-function tools (web_search) and keeps Responses-style function tools with top-level name", () => {
    // This is the shape Codex actually sends to /v1/responses: function tools
    // carry `name` at the top level, and web_search has no name at all.
    const common = fromOpenaiRequest({
      model: "deepseek-v4-pro",
      input: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", name: "shell_command", description: "run a shell command", parameters: { type: "object" } },
        { type: "namespace", name: "mcp__node_repl", description: "mcp tools", tools: [] },
        { type: "web_search", external_web_access: true },
      ],
    })

    expect(toOaCompatibleRequest(common).tools).toEqual([
      {
        type: "function",
        function: { name: "shell_command", description: "run a shell command", parameters: { type: "object" } },
      },
    ])
  })

  test("keeps chat-completions-style function tools with nested function.name", () => {
    const common = fromOpenaiRequest({
      model: "m",
      input: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "get_weather", description: "x", parameters: { type: "object" } } }],
    })

    expect(toOaCompatibleRequest(common).tools).toEqual([
      { type: "function", function: { name: "get_weather", description: "x", parameters: { type: "object" } } },
    ])
  })

  test("omits tools when the request has none", () => {
    const common = fromOpenaiRequest({ model: "m", input: [{ role: "user", content: "hi" }] })
    expect(toOaCompatibleRequest(common).tools).toBeUndefined()
  })
})