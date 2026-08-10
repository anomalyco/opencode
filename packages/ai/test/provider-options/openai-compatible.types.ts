import { LLM } from "../../src"
import { OpenAICompatible } from "../../src/providers"

const model = OpenAICompatible.deepseek.model("deepseek-chat")

LLM.request({ model, prompt: "Hello", providerOptions: { openai: { store: false } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenAI-compatible store must be boolean.
  providerOptions: { openai: { store: "false" } },
})
