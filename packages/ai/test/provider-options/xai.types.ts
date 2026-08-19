import { LLM } from "../../src/index.js"
import { XAI } from "../../src/providers.js"

const model = XAI.provider.model("grok-4")

LLM.request({ model, prompt: "Hello", providerOptions: { xai: { reasoningEffort: "high" } } })
LLM.request({ model, prompt: "Hello", providerOptions: { xai: { reasoningEffort: "experimental" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error xAI's OpenAI-compatible reasoning effort must be a string.
  providerOptions: { xai: { reasoningEffort: true } },
})
