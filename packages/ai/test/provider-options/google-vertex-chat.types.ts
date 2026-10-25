import { LLM } from "../../src/effect.js"
import { GoogleVertexChat } from "../../src/providers.js"

const model = GoogleVertexChat.configure({ accessToken: "test", project: "project" }).model("gemini")

LLM.request({ model, prompt: "Hello", providerOptions: { serviceTier: "priority" } })
LLM.request({ model, prompt: "Hello", providerOptions: { serviceTier: "future-tier" } })
