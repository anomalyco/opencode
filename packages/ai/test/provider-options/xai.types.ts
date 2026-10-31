import { XAI } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = XAI.provider.model("grok-4")

LLMRequest.from({ model, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
LLMRequest.from({ model, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error xAI's OpenAI-compatible reasoning effort must be a string.
  providerOptions: { reasoningEffort: true },
})
