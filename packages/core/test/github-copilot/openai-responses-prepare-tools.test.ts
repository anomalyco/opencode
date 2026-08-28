import { expect, test } from "bun:test"
import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider"
import { prepareResponsesTools } from "@opencode-ai/core/github-copilot/responses/openai-responses-prepare-tools"

function prepare(strict: boolean | undefined, strictJsonSchema: boolean) {
  const tool: LanguageModelV3FunctionTool = {
    type: "function",
    name: "lookup",
    inputSchema: { type: "object", properties: {} },
    strict,
  }
  return prepareResponsesTools({ tools: [tool], strictJsonSchema }).tools?.[0]
}

test("function tools prefer explicit strictness over the global fallback", () => {
  expect(prepare(true, false)).toMatchObject({ type: "function", strict: true })
  expect(prepare(false, true)).toMatchObject({ type: "function", strict: false })
  expect(prepare(undefined, true)).toMatchObject({ type: "function", strict: true })
  expect(prepare(undefined, false)).toMatchObject({ type: "function", strict: false })
})
