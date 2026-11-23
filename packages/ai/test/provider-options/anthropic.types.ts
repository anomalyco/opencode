import { ai } from "../../src/effect.js"
import { Anthropic } from "../../src/providers.js"

const model = Anthropic.provider.model("claude-sonnet-4-5")

ai.request({ model, prompt: "Hello", providerOptions: { thinking: { type: "adaptive" } } })
ai.request({
  model,
  prompt: "Hello",
  providerOptions: {
    serviceTier: "future-tier",
    thinking: { type: "adaptive", display: "future-display" },
    cacheControl: { type: "ephemeral", ttl: "30m" },
  },
})
ai.request({
  model,
  prompt: "Hello",
  providerOptions: {
    // @ts-expect-error Cache TTLs are durations such as "5m" or "1h".
    cacheControl: { type: "ephemeral", ttl: "future-ttl" },
  },
})

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic thinking modes are a fixed union.
  providerOptions: { thinking: { type: "automatic" } },
})
