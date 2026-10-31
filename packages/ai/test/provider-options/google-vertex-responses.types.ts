import { GoogleVertexResponses } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = GoogleVertexResponses.configure({ accessToken: "test", project: "project" }).model("gemini")

LLMRequest.from({ model, prompt: "Hello", providerOptions: { textVerbosity: "high" } })
LLMRequest.from({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Responses verbosity must be a string.
  providerOptions: { textVerbosity: 1 },
})
