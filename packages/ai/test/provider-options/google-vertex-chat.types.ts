import { ai } from "../../src/effect.js"
import { GoogleVertexChat } from "../../src/providers.js"

const model = GoogleVertexChat.model("gemini", { accessToken: "test", project: "project" })

ai.request({ model, prompt: "Hello", providerOptions: { serviceTier: "priority" } })
ai.request({ model, prompt: "Hello", providerOptions: { serviceTier: "future-tier" } })
