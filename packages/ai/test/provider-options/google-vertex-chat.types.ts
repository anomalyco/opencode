import { GoogleVertexChat } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = GoogleVertexChat.configure({ accessToken: "test", project: "project" }).model("gemini")

LLMRequest.from({ model, prompt: "Hello", providerOptions: { serviceTier: "priority" } })
LLMRequest.from({ model, prompt: "Hello", providerOptions: { serviceTier: "future-tier" } })
