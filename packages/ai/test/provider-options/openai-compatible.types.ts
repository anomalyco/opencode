import { ai } from "../../src/effect.js"
import { OpenAICompatible } from "../../src/providers.js"

const model = OpenAICompatible.configure({ baseURL: "https://compatible.example/v1" }).model("test-model")

ai.request({ model, prompt: "Hello", providerOptions: { store: false } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenAI-compatible store must be boolean.
  providerOptions: { store: "false" },
})
