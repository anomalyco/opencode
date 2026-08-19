import { LLM } from "../../src/index.js"
import { OpenAI } from "../../src/providers.js"

const selected = OpenAI.responses("gpt-5")
const chat = OpenAI.chat("gpt-4o-mini")

LLM.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
LLM.request({ model: selected, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })
LLM.request({ model: selected, prompt: "Hello", providerOptions: { textVerbosity: "low" } })
LLM.request({ model: selected, prompt: "Hello", providerOptions: { textVerbosity: "verbose" } })
LLM.request({ model: chat, prompt: "Hello", providerOptions: { reasoningEffort: "max" } })
LLM.request({ model: chat, prompt: "Hello", providerOptions: { reasoningEffort: "experimental" } })

LLM.request({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error OpenAI reasoning effort must be a string.
  providerOptions: { reasoningEffort: 1 },
})

OpenAI.configure({
  // @ts-expect-error Transport is execution policy, not provider configuration.
  transport: "websocket",
})
