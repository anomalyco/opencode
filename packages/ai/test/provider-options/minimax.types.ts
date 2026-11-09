import { ai } from "../../src/effect.js"
import { MiniMax } from "../../src/providers.js"

const minimax = MiniMax.configure()

ai.request({ model: minimax.model("MiniMax-M3"), prompt: "Hello", providerOptions: { thinking: { type: "adaptive" } } })
ai.request({ model: minimax.chat("MiniMax-M3"), prompt: "Hello", providerOptions: { thinking: { type: "disabled" } } })
ai.request({ model: minimax.chat("MiniMax-M3"), prompt: "Hello", providerOptions: { reasoningSplit: false } })
ai.request({ model: minimax.responses("MiniMax-M3"), prompt: "Hello", providerOptions: { reasoningEffort: "minimal" } })
ai.request({
  model: minimax.responses("MiniMax-M3"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "future-effort" },
})

ai.request({
  model: minimax.model("MiniMax-M3"),
  prompt: "Hello",
  // @ts-expect-error MiniMax Messages has no documented effort setting.
  providerOptions: { effort: "high" },
})
ai.request({
  model: minimax.chat("MiniMax-M3"),
  prompt: "Hello",
  // @ts-expect-error Chat reasoning_split is a boolean.
  providerOptions: { reasoningSplit: "true" },
})
ai.request({
  model: minimax.responses("MiniMax-M3"),
  prompt: "Hello",
  // @ts-expect-error MiniMax Responses uses reasoning effort rather than Messages thinking.
  providerOptions: { thinking: { type: "adaptive" } },
})
