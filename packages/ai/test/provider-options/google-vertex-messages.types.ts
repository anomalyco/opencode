import { GoogleVertexMessages } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = GoogleVertexMessages.configure({ accessToken: "test", project: "project" }).model("claude")

LLMRequest.from({ model, prompt: "Hello", providerOptions: { effort: "medium" } })

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Anthropic effort must be a string.
  providerOptions: { effort: false },
})
