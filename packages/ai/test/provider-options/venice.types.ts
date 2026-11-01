import { ai } from "../../src/effect.js"
import { venice } from "../../src/providers.js"

ai.request({
  model: venice.chat("qwen3-6-27b"),
  prompt: "Hello",
  providerOptions: {
    reasoningEffort: "high",
    reasoning: { summary: "concise" },
    veniceParameters: { includeVeniceSystemPrompt: false },
  },
})
ai.request({
  model: venice.configure({ providerOptions: { reasoningEffort: "future-effort" } })("future-model"),
  prompt: "Hello",
  providerOptions: {
    reasoning: { enabled: false },
    promptCacheRetention: "future-retention",
    parallelToolCalls: false,
  },
})
ai.request({
  model: venice.chat("qwen3-6-27b"),
  prompt: "Hello",
  // @ts-expect-error Thinking toggles are boolean.
  providerOptions: { reasoning: { enabled: "false" } },
})
ai.request({
  model: venice.chat("qwen3-6-27b"),
  prompt: "Hello",
  // @ts-expect-error Venice uses nested reasoning, not Anthropic thinking controls.
  providerOptions: { thinking: { type: "disabled" } },
})
ai.request({
  model: venice.chat("qwen3-6-27b"),
  prompt: "Hello",
  // @ts-expect-error Venice's system-prompt toggle is boolean.
  providerOptions: { veniceParameters: { includeVeniceSystemPrompt: "false" } },
})
