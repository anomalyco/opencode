import { LLM } from "../../src/index.js"
import { GoogleVertexResponses } from "../../src/providers.js"

const model = GoogleVertexResponses.configure({ accessToken: "test", project: "project" }).model("gemini")

LLM.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "high" } })
LLM.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Responses verbosity must be a string.
  providerOptions: { textVerbosity: 1 },
})
