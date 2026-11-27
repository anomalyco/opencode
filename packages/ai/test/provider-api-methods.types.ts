import { ai } from "../src/index.js"
import { DigitalOcean, OpenAI, OpenRouter, Venice, XAI } from "../src/providers.js"

void ai.generate({ model: OpenAI.openai.model("x", { api: "chat-completions" }), prompt: "Say hi" })
void ai.generate({ model: XAI.xai.model("x", { api: "chat-completions" }), prompt: "Say hi" })
void ai.generate({ model: Venice.venice.model("x", { api: "chat-completions" }), prompt: "Say hi" })
void ai.generate({ model: OpenRouter.openrouter.model("x", { api: "chat-completions" }), prompt: "Say hi" })
void ai.generate({ model: DigitalOcean.digitalocean.model("x", { api: "chat-completions" }), prompt: "Say hi" })
// @ts-expect-error Providers only serve the APIs they list.
OpenAI.openai.model("x", { api: "messages" })
