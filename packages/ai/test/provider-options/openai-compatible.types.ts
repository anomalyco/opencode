import { ai } from "../../src/effect.js"
import { OpenAICompatible } from "../../src/providers.js"

const model = OpenAICompatible.model("test-model", { baseURL: "https://compatible.example/v1" })

ai.request({ model, prompt: "Hello", providerOptions: { store: false } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenAI-compatible store must be boolean.
  providerOptions: { store: "false" },
})
