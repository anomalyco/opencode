import { OpenAI } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const selected = OpenAI.responses("gpt-5")
const chat = OpenAI.chat("gpt-4o-mini")

LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { textVerbosity: "low" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "scale" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "ultrafast" } })
LLMRequest.from({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "future-tier" } })
LLMRequest.from({ model: chat, prompt: "Hello", providerOptions: { reasoningEffort: "max" } })
LLMRequest.from({ model: chat, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })

LLMRequest.from({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error OpenAI reasoning effort must be a string.
  providerOptions: { reasoningEffort: 1 },
})

OpenAI.configure({
  // @ts-expect-error Transport is execution policy, not provider configuration.
  transport: "websocket",
})
