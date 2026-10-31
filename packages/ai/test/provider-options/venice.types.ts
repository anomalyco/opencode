import { Venice } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

LLMRequest.from({
  model: Venice.chat("qwen3-6-27b"),
  providerOptions: {
    reasoningEffort: "high",
    reasoning: { summary: "concise" },
    veniceParameters: { includeVeniceSystemPrompt: false },
  },
})
LLMRequest.from({
  model: Venice.configure({ providerOptions: { reasoningEffort: "future-effort" } }).model("future-model"),
  providerOptions: {
    reasoning: { enabled: false },
    promptCacheRetention: "future-retention",
    parallelToolCalls: false,
  },
})
LLMRequest.from({
  model: Venice.chat("qwen3-6-27b"),
  // @ts-expect-error Thinking toggles are boolean.
  providerOptions: { reasoning: { enabled: "false" } },
})
LLMRequest.from({
  model: Venice.chat("qwen3-6-27b"),
  // @ts-expect-error Venice uses nested reasoning, not Anthropic thinking controls.
  providerOptions: { thinking: { type: "disabled" } },
})
LLMRequest.from({
  model: Venice.chat("qwen3-6-27b"),
  // @ts-expect-error Venice's system-prompt toggle is boolean.
  providerOptions: { veniceParameters: { includeVeniceSystemPrompt: "false" } },
})
