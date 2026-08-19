import { LLM } from "../../src/index.js"
import { OpenAICompatibleResponses } from "../../src/providers.js"

const model = OpenAICompatibleResponses.configure({ baseURL: "https://example.com" }).model("model")

LLM.request({ model, prompt: "Hello", providerOptions: { reasoningSummary: "detailed" } })
LLM.request({ model, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
LLM.request({ model, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })
LLM.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "low" } })
LLM.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Open Responses reasoning summaries use a fixed union.
  providerOptions: { reasoningSummary: "full" },
})
