import { ai } from "../../src/effect.js"
import { openaiCompatibleResponses } from "../../src/providers.js"

const model = openaiCompatibleResponses.configure({ baseURL: "https://example.com" })("model")

ai.request({ model, prompt: "Hello", providerOptions: { reasoningSummary: "detailed" } })
ai.request({ model, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
ai.request({ model, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })
ai.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "low" } })
ai.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Open Responses reasoning summaries use a fixed union.
  providerOptions: { reasoningSummary: "full" },
})
