import { ai } from "../../src/effect.js"
import { GoogleVertexResponses } from "../../src/providers.js"

const model = GoogleVertexResponses.model("gemini", { accessToken: "test", project: "project" })

ai.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "high" } })
ai.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Responses verbosity must be a string.
  providerOptions: { textVerbosity: 1 },
})
