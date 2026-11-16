import { ai } from "../src/index.js"
import { DigitalOcean, OpenAI, OpenRouter, Venice, XAI } from "../src/providers.js"

for (const p of [OpenAI, XAI, Venice, OpenRouter, DigitalOcean]) {
  p.chat("x")
  p.configure().chat("x")
  void ai.generate({ model: p.chat("x"), prompt: "Say hi" })
}
