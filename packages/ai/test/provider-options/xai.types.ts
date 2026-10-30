import { ai } from "../../src/effect.js"
import { XAI } from "../../src/providers.js"

const model = XAI.provider.model("grok-4")

ai.text.request({ model, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
ai.text.request({ model, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })

ai.text.request({
  model,
  prompt: "Hello",
  // @ts-expect-error xAI's OpenAI-compatible reasoning effort must be a string.
  providerOptions: { reasoningEffort: true },
})
