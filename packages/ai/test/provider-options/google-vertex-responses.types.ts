import { ai } from "../../src/effect.js"
import { GoogleVertexResponses } from "../../src/providers.js"

const model = GoogleVertexResponses.configure({ accessToken: "test", project: "project" }).model("gemini")

ai.text.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "high" } })
ai.text.request({ model, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })

ai.text.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Responses verbosity must be a string.
  providerOptions: { textVerbosity: 1 },
})
