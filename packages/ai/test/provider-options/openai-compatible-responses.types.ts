import { LLM } from "../../src"
import { OpenAICompatibleResponses } from "../../src/providers"

const model = OpenAICompatibleResponses.configure({ baseURL: "https://example.com" }).model("model")

LLM.request({ model, prompt: "Hello", providerOptions: { openresponses: { reasoningSummary: "detailed" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Open Responses reasoning summaries use a fixed union.
  providerOptions: { openresponses: { reasoningSummary: "full" } },
})
