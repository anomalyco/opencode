import { ai } from "../../src/effect.js"
import { minimax } from "../../src/providers.js"

const minimaxProvider = minimax.configure()

ai.request({ model: minimaxProvider("MiniMax-M3"), prompt: "Hello", providerOptions: { thinking: { type: "adaptive" } } })
ai.request({ model: minimaxProvider.chat("MiniMax-M3"), prompt: "Hello", providerOptions: { thinking: { type: "disabled" } } })
ai.request({ model: minimaxProvider.chat("MiniMax-M3"), prompt: "Hello", providerOptions: { reasoningSplit: false } })
ai.request({ model: minimaxProvider.responses("MiniMax-M3"), prompt: "Hello", providerOptions: { reasoningEffort: "minimal" } })
ai.request({
  model: minimaxProvider.responses("MiniMax-M3"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "future-effort" },
})

ai.request({
  model: minimaxProvider("MiniMax-M3"),
  prompt: "Hello",
  // @ts-expect-error MiniMax Messages has no documented effort setting.
  providerOptions: { effort: "high" },
})
ai.request({
  model: minimaxProvider.chat("MiniMax-M3"),
  prompt: "Hello",
  // @ts-expect-error Chat reasoning_split is a boolean.
  providerOptions: { reasoningSplit: "true" },
})
ai.request({
  model: minimaxProvider.responses("MiniMax-M3"),
  prompt: "Hello",
  // @ts-expect-error MiniMax Responses uses reasoning effort rather than Messages thinking.
  providerOptions: { thinking: { type: "adaptive" } },
})
