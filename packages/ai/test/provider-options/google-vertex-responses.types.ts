import { LLM } from "../../src/index.js"
import { GoogleVertexResponses } from "../../src/providers.js"

const model = GoogleVertexResponses.configure({ accessToken: "test", project: "project" }).model("gemini")

LLM.request({ model, prompt: "Hello", providerOptions: { openresponses: { textVerbosity: "high" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Responses verbosity uses the Open Responses union.
  providerOptions: { openresponses: { textVerbosity: "verbose" } },
})
