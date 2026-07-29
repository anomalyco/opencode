import { LLM } from "../../src"
import { CloudflareWorkersAI } from "../../src/providers"

const model = CloudflareWorkersAI.configure({ accountId: "account", apiKey: "test" }).model("model")

LLM.request({ model, prompt: "Hello", providerOptions: { openai: { promptCacheKey: "cache" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Cloudflare's OpenAI-compatible prompt cache key must be a string.
  providerOptions: { openai: { promptCacheKey: 1 } },
})
