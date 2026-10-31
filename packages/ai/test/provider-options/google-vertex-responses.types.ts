import { ai } from "../../src/effect.js"
import { googleVertexResponses } from "../../src/providers.js"

const model = googleVertexResponses.configure({ accessToken: "test", project: "project" })("gemini")

ai.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "high" } })
ai.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Responses verbosity must be a string.
  providerOptions: { textVerbosity: 1 },
})
