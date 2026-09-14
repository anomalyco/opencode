import { LLM } from "../../src/index.js"
import { MiniMax } from "../../src/providers.js"

const minimax = MiniMax.configure()

LLM.request({ model: minimax.model("MiniMax-M3"), providerOptions: { thinking: { type: "adaptive" } } })
LLM.request({ model: minimax.chat("MiniMax-M3"), providerOptions: { thinking: { type: "disabled" } } })
LLM.request({ model: minimax.chat("MiniMax-M3"), providerOptions: { reasoningSplit: false } })
LLM.request({ model: minimax.responses("MiniMax-M3"), providerOptions: { reasoningEffort: "minimal" } })
LLM.request({ model: minimax.responses("MiniMax-M3"), providerOptions: { reasoningEffort: "future-effort" } })

LLM.request({
  model: minimax.model("MiniMax-M3"),
  // @ts-expect-error MiniMax Messages has no documented effort setting.
  providerOptions: { effort: "high" },
})
LLM.request({
  model: minimax.chat("MiniMax-M3"),
  // @ts-expect-error Chat reasoning_split is a boolean.
  providerOptions: { reasoningSplit: "true" },
})
LLM.request({
  model: minimax.responses("MiniMax-M3"),
  // @ts-expect-error MiniMax Responses uses reasoning effort rather than Messages thinking.
  providerOptions: { thinking: { type: "adaptive" } },
})
