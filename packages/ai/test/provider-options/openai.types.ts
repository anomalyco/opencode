import { ai } from "../../src/effect.js"
import { OpenAI } from "../../src/providers.js"

const selected = OpenAI.responses("gpt-5")
const chat = OpenAI.chat("gpt-4o-mini")

ai.text.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
ai.text.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })
ai.text.request({ model: selected, prompt: "Hello", providerOptions: { textVerbosity: "low" } })
ai.text.request({ model: selected, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })
ai.text.request({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "scale" } })
ai.text.request({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "ultrafast" } })
ai.text.request({ model: selected, prompt: "Hello", providerOptions: { serviceTier: "future-tier" } })
ai.text.request({ model: chat, prompt: "Hello", providerOptions: { reasoningEffort: "max" } })
ai.text.request({ model: chat, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })

ai.text.request({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error OpenAI reasoning effort must be a string.
  providerOptions: { reasoningEffort: 1 },
})

OpenAI.configure({
  // @ts-expect-error Transport is execution policy, not provider configuration.
  transport: "websocket",
})
