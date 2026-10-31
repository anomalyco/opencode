import { Mistral } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const selected = Mistral.provider.model("mistral-small-latest")

LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "future-effort" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { promptMode: "reasoning" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { parallelToolCalls: false } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { promptCacheKey: "session-1" } })

LLMRequest.from({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error Mistral reasoning effort must be a string.
  providerOptions: { reasoningEffort: 1 },
})

LLMRequest.from({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error Mistral prompt mode only supports reasoning.
  providerOptions: { promptMode: "standard" },
})
