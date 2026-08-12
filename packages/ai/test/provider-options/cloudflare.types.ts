import { LLM } from "../../src/index.js"
import { CloudflareWorkersAI } from "../../src/providers.js"

const model = CloudflareWorkersAI.configure({ accountId: "account", apiKey: "test" }).model("model")

LLM.request({ model, prompt: "Hello", promptCacheKey: "cache" })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Prompt cache keys must be strings.
  promptCacheKey: 1,
})
