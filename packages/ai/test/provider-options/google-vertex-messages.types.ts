import { ai } from "../../src/effect.js"
import { googleVertexMessages } from "../../src/providers.js"

const model = googleVertexMessages.configure({ accessToken: "test", project: "project" })("claude")

ai.request({ model, prompt: "Hello", providerOptions: { effort: "medium" } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Anthropic effort must be a string.
  providerOptions: { effort: false },
})
