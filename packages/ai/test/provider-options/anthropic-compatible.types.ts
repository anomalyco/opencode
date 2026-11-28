import { ai } from "../../src/effect.js"
import { AnthropicCompatible } from "../../src/providers.js"

const model = AnthropicCompatible.model("claude", { baseURL: "https://example.com" })

ai.request({ model, prompt: "Hello", providerOptions: { effort: "high" } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic effort must be a string.
  providerOptions: { effort: 1 },
})
