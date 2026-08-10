import { LLM } from "../../src"
import { OpenAI } from "../../src/providers"

const model = OpenAI.responses("gpt-5")

LLM.request({ model, prompt: "Hello", providerOptions: { openai: { reasoningEffort: "high" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenAI reasoning effort must be a string.
  providerOptions: { openai: { reasoningEffort: 1 } },
})
