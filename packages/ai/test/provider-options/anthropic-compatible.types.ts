import { LLM } from "../../src/index.js"
import { AnthropicCompatible } from "../../src/providers.js"

const model = AnthropicCompatible.configure({ baseURL: "https://example.com" }).model("claude")

LLM.request({ model, prompt: "Hello", providerOptions: { effort: "high" } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic effort must be a string.
  providerOptions: { effort: 1 },
})
