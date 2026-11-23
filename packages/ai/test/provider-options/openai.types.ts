import { ai } from "../../src/effect.js"
import { OpenAI } from "../../src/providers.js"

const selected = OpenAI.responses("gpt-5")
const chat = OpenAI.chat("gpt-4o-mini")

ai.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { textVerbosity: "low" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "scale" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "ultrafast" } })
ai.request({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "future-tier" } })
ai.request({ model: chat, prompt: "Hello", providerOptions: { reasoningEffort: "max" } })
ai.request({ model: chat, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })

ai.request({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error OpenAI reasoning effort must be a string.
  providerOptions: { reasoningEffort: 1 },
})

OpenAI.configure({
  // @ts-expect-error Transport is execution policy, not provider configuration.
  transport: "websocket",
})
