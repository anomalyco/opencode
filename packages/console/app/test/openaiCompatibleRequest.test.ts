import { describe, expect, test } from "bun:test"
import { fromOpenaiRequest } from "../src/routes/zen/util/provider/openai"
import {
  fromOaCompatibleRequest,
  toOaCompatibleRequest,
} from "../src/routes/zen/util/provider/openai-compatible"

describe("toOaCompatibleRequest tool conversion", () => {
  test("drops non-function tools like web_search and keeps function tools", () => {
    const common = fromOpenaiRequest({
      model: "deepseek-v4-flash-free",
      input: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "get_weather", description: "x", parameters: { type: "object" } } },
        { type: "web_search", external_web_access: false },
      ],
    })

    expect(toOaCompatibleRequest(common).tools).toEqual([
      {
        type: "function",
        function: { name: "get_weather", description: "x", parameters: { type: "object" } },
      },
    ])
  })

  test("passes through chat-completions function tools unchanged", () => {
    const common = fromOaCompatibleRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
    })

    expect(toOaCompatibleRequest(common).tools).toEqual([
      { type: "function", function: { name: "get_weather", parameters: { type: "object" } } },
    ])
  })

  test("omits tools when the request has none", () => {
    const common = fromOpenaiRequest({ model: "m", input: [{ role: "user", content: "hi" }] })
    expect(toOaCompatibleRequest(common).tools).toBeUndefined()
  })
})
