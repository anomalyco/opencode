import { LLM } from "../../src/index.js"
import { GoogleVertexMessages } from "../../src/providers.js"

const model = GoogleVertexMessages.configure({ accessToken: "test", project: "project" }).model("claude")

LLM.request({ model, prompt: "Hello", providerOptions: { anthropic: { effort: "medium" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Anthropic effort must be a string.
  providerOptions: { anthropic: { effort: false } },
})
