import { ai } from "../../src/effect.js"
import { anthropicCompatible } from "../../src/providers.js"

const model = anthropicCompatible.configure({ baseURL: "https://example.com" })("claude")

ai.request({ model, prompt: "Hello", providerOptions: { effort: "high" } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic effort must be a string.
  providerOptions: { effort: 1 },
})
