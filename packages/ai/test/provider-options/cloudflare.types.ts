import { CloudflareWorkersAI } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = CloudflareWorkersAI.configure({ accountId: "account", apiKey: "test" }).model("model")

LLMRequest.from({ model, prompt: "Hello", promptCacheKey: "cache" })

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error Prompt cache keys must be strings.
  promptCacheKey: 1,
})
