import { ai } from "../../src/effect.js"
import { googleVertexChat } from "../../src/providers.js"

const model = googleVertexChat.configure({ accessToken: "test", project: "project" })("gemini")

ai.request({ model, prompt: "Hello", providerOptions: { serviceTier: "priority" } })
ai.request({ model, prompt: "Hello", providerOptions: { serviceTier: "future-tier" } })
