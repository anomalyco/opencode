import { LLM } from "../../src/index.js"
import { Mistral } from "../../src/providers.js"

const selected = Mistral.provider.model("mistral-small-latest")

LLM.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
LLM.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "future-effort" } })
LLM.request({ model: selected, prompt: "Hello", providerOptions: { promptMode: "reasoning" } })
LLM.request({ model: selected, prompt: "Hello", providerOptions: { parallelToolCalls: false } })
LLM.request({ model: selected, prompt: "Hello", providerOptions: { promptCacheKey: "session-1" } })

LLM.request({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error Mistral reasoning effort must be a string.
  providerOptions: { reasoningEffort: 1 },
})

LLM.request({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error Mistral prompt mode only supports reasoning.
  providerOptions: { promptMode: "standard" },
})
