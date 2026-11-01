import { ai } from "../../src/effect.js"
import { openaiCompatible } from "../../src/providers.js"

const model = openaiCompatible.configure({ baseURL: "https://compatible.example/v1" })("test-model")

ai.request({ model, prompt: "Hello", providerOptions: { store: false } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenAI-compatible store must be boolean.
  providerOptions: { store: "false" },
})
