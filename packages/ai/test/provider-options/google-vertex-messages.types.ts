import { ai } from "../../src/effect.js"
import { GoogleVertexMessages } from "../../src/providers.js"

const model = GoogleVertexMessages.model("claude", { accessToken: "test", project: "project" })

ai.request({ model, prompt: "Hello", providerOptions: { effort: "medium" } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Anthropic effort must be a string.
  providerOptions: { effort: false },
})
