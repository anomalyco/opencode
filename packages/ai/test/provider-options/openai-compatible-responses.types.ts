import { ai } from "../../src/effect.js"
import { OpenAICompatibleResponses } from "../../src/providers.js"

const model = OpenAICompatibleResponses.configure({ baseURL: "https://example.com" }).model("model")

ai.text.request({ model, prompt: "Hello", providerOptions: { reasoningSummary: "detailed" } })
ai.text.request({ model, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
ai.text.request({ model, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })
ai.text.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "low" } })
ai.text.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

ai.text.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Open Responses reasoning summaries use a fixed union.
  providerOptions: { reasoningSummary: "full" },
})
