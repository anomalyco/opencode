import { ai } from "../src/index.js"
import { digitalocean, openai, openrouter, venice, xai } from "../src/providers.js"

for (const p of [openai, xai, venice, openrouter, digitalocean]) {
  p.chat("x")
  p.configure().chat("x")
  void ai.generate({ model: p.chat("x"), prompt: "Say hi" })
}
