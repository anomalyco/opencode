import { LLM } from "../../src/index.js"
import { GoogleVertexChat } from "../../src/providers.js"

const model = GoogleVertexChat.configure({ accessToken: "test", project: "project" }).model("gemini")

LLM.request({ model, prompt: "Hello", providerOptions: { openai: { serviceTier: "priority" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex OpenAI-compatible service tiers use the OpenAI union.
  providerOptions: { openai: { serviceTier: "premium" } },
})
