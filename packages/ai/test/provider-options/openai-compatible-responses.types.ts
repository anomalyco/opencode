import { OpenAICompatibleResponses } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = OpenAICompatibleResponses.configure({ baseURL: "https://example.com" }).model("model")

LLMRequest.from({ model, prompt: "Hello", providerOptions: { reasoningSummary: "detailed" } })
LLMRequest.from({ model, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
LLMRequest.from({ model, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })
LLMRequest.from({ model, prompt: "Hello", providerOptions: { textVerbosity: "low" } })
LLMRequest.from({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error Open Responses reasoning summaries use a fixed union.
  providerOptions: { reasoningSummary: "full" },
})
