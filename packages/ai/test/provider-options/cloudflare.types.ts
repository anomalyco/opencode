import { ai } from "../../src/effect.js"
import { cloudflareWorkersAI } from "../../src/providers.js"

const model = cloudflareWorkersAI.configure({ accountId: "account", apiKey: "test" })("model")

ai.request({ model, prompt: "Hello", promptCacheKey: "cache" })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Prompt cache keys must be strings.
  promptCacheKey: 1,
})
