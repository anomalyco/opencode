import { ai } from "../../src/effect.js"
import { CloudflareWorkersAI } from "../../src/providers.js"

const model = CloudflareWorkersAI.configure({ accountId: "account", apiKey: "test" }).model("model")

ai.text.request({ model, prompt: "Hello", promptCacheKey: "cache" })

ai.text.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Prompt cache keys must be strings.
  promptCacheKey: 1,
})
