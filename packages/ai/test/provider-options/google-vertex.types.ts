import { GoogleVertex } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = GoogleVertex.provider.configure({ apiKey: "test" }).model("gemini-2.5-pro")

LLMRequest.from({
  model,
  prompt: "Hello",
  providerOptions: { thinkingConfig: { includeThoughts: true } },
})

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Gemini includeThoughts must be boolean.
  providerOptions: { thinkingConfig: { includeThoughts: "yes" } },
})
