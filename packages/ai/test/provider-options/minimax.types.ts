import { MiniMax } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const minimax = MiniMax.configure()

LLMRequest.from({ model: minimax.model("MiniMax-M3"), providerOptions: { thinking: { type: "adaptive" } } })
LLMRequest.from({ model: minimax.chat("MiniMax-M3"), providerOptions: { thinking: { type: "disabled" } } })
LLMRequest.from({ model: minimax.chat("MiniMax-M3"), providerOptions: { reasoningSplit: false } })
LLMRequest.from({ model: minimax.responses("MiniMax-M3"), providerOptions: { reasoningEffort: "minimal" } })
LLMRequest.from({ model: minimax.responses("MiniMax-M3"), providerOptions: { reasoningEffort: "future-effort" } })

LLMRequest.from({
  model: minimax.model("MiniMax-M3"),
  // @ts-expect-error MiniMax Messages has no documented effort setting.
  providerOptions: { effort: "high" },
})
LLMRequest.from({
  model: minimax.chat("MiniMax-M3"),
  // @ts-expect-error Chat reasoning_split is a boolean.
  providerOptions: { reasoningSplit: "true" },
})
LLMRequest.from({
  model: minimax.responses("MiniMax-M3"),
  // @ts-expect-error MiniMax Responses uses reasoning effort rather than Messages thinking.
  providerOptions: { thinking: { type: "adaptive" } },
})
