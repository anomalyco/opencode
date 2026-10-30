import { ai } from "../../src/effect.js"
import { GoogleVertexChat } from "../../src/providers.js"

const model = GoogleVertexChat.configure({ accessToken: "test", project: "project" }).model("gemini")

ai.text.request({ model, prompt: "Hello", providerOptions: { serviceTier: "priority" } })
ai.text.request({ model, prompt: "Hello", providerOptions: { serviceTier: "future-tier" } })
