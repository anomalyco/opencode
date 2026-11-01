import { ai } from "../../src/effect.js"
import { mistral } from "../../src/providers.js"

const selected = mistral("mistral-small-latest")

ai.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "future-effort" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { promptMode: "reasoning" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { parallelToolCalls: false } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { promptCacheKey: "session-1" } })

ai.request({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error Mistral reasoning effort must be a string.
  providerOptions: { reasoningEffort: 1 },
})

ai.request({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error Mistral prompt mode only supports reasoning.
  providerOptions: { promptMode: "standard" },
})
