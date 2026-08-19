import { LLM } from "../../src/index.js"
import { OpenAICompatible } from "../../src/providers.js"

const model = OpenAICompatible.deepseek.model("deepseek-chat")

LLM.request({ model, prompt: "Hello", providerOptions: { store: false } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenAI-compatible store must be boolean.
  providerOptions: { store: "false" },
})
