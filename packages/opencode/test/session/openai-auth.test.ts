import { expect, test } from "bun:test"
import { isOpenAIChatGPTAuth } from "../../src/session/llm/openai-auth"

test("recognizes OpenAI ChatGPT authentication sources", () => {
  expect(
    isOpenAIChatGPTAuth({
      provider: { id: "openai", options: { openaiAuth: "broker" } },
      auth: undefined,
    }),
  ).toBe(true)
  expect(
    isOpenAIChatGPTAuth({
      provider: { id: "openai", options: {} },
      auth: { type: "oauth" },
    }),
  ).toBe(true)
  expect(
    isOpenAIChatGPTAuth({
      provider: { id: "openai", options: {} },
      auth: { type: "api" },
    }),
  ).toBe(false)
})
