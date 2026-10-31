import { AnthropicCompatible } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = AnthropicCompatible.configure({ baseURL: "https://example.com" }).model("claude")

LLMRequest.from({ model, prompt: "Hello", providerOptions: { effort: "high" } })

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic effort must be a string.
  providerOptions: { effort: 1 },
})
