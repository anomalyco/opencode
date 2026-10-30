import { ai } from "../../src/effect.js"
import { AnthropicCompatible } from "../../src/providers.js"

const model = AnthropicCompatible.configure({ baseURL: "https://example.com" }).model("claude")

ai.text.request({ model, prompt: "Hello", providerOptions: { effort: "high" } })

ai.text.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic effort must be a string.
  providerOptions: { effort: 1 },
})
