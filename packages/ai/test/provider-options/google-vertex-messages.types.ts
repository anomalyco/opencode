import { ai } from "../../src/effect.js"
import { GoogleVertexMessages } from "../../src/providers.js"

const model = GoogleVertexMessages.configure({ accessToken: "test", project: "project" }).model("claude")

ai.text.request({ model, prompt: "Hello", providerOptions: { effort: "medium" } })

ai.text.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Anthropic effort must be a string.
  providerOptions: { effort: false },
})
