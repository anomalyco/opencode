import { LLM } from "../../src/index.js"
import { Anthropic } from "../../src/providers.js"

const model = Anthropic.provider.model("claude-sonnet-4-5")

LLM.request({ model, prompt: "Hello", providerOptions: { thinking: { type: "adaptive" } } })
LLM.request({
  model,
  prompt: "Hello",
  providerOptions: {
    serviceTier: "future-tier",
    thinking: { type: "adaptive", display: "future-display" },
  },
})
LLM.request({
  model,
  prompt: "Hello",
  providerOptions: {
    // @ts-expect-error Anthropic cache TTL values are protocol constraints.
    cacheControl: { type: "ephemeral", ttl: "future-ttl" },
  },
})

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic thinking modes are a fixed union.
  providerOptions: { thinking: { type: "automatic" } },
})
