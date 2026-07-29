import { LLM } from "../../src"
import { AnthropicCompatible } from "../../src/providers"

const model = AnthropicCompatible.configure({ baseURL: "https://example.com" }).model("claude")

LLM.request({ model, prompt: "Hello", providerOptions: { anthropic: { effort: "high" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic effort must be a string.
  providerOptions: { anthropic: { effort: 1 } },
})
