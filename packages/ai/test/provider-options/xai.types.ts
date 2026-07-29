import { LLM } from "../../src"
import { XAI } from "../../src/providers"

const model = XAI.provider.model("grok-4")

LLM.request({ model, prompt: "Hello", providerOptions: { openai: { reasoningEffort: "high" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error xAI's OpenAI-compatible reasoning effort must be a string.
  providerOptions: { openai: { reasoningEffort: true } },
})
