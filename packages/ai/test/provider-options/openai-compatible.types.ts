import { OpenAICompatible } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = OpenAICompatible.configure({ baseURL: "https://compatible.example/v1" }).model("test-model")

LLMRequest.from({ model, prompt: "Hello", providerOptions: { store: false } })

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenAI-compatible store must be boolean.
  providerOptions: { store: "false" },
})
