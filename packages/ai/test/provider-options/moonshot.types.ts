import { Moonshot } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const moonshot = Moonshot.configure()

LLMRequest.from({ model: moonshot.model("kimi-k2.6"), providerOptions: { thinking: { type: "enabled", keep: "all" } } })
LLMRequest.from({ model: moonshot.chat("kimi-k2.6"), providerOptions: { thinking: { type: "disabled", keep: null } } })
LLMRequest.from({ model: moonshot.chat("kimi-k3"), providerOptions: { reasoningEffort: "high" } })
LLMRequest.from({
  model: moonshot.messages("kimi-k3"),
  providerOptions: { effort: "low", metadata: { user_id: "fixture" } },
})
LLMRequest.from({ model: moonshot.responses("kimi-k3"), providerOptions: { reasoningEffort: "future-effort" } })

LLMRequest.from({
  model: moonshot.messages("kimi-k3"),
  // @ts-expect-error Messages exposes effort rather than the K2 Chat thinking parameter.
  providerOptions: { thinking: { type: "enabled" } },
})
LLMRequest.from({
  model: moonshot.chat("kimi-k2.6"),
  // @ts-expect-error Preserved thinking takes a string or null.
  providerOptions: { thinking: { type: "enabled", keep: true } },
})
LLMRequest.from({
  model: moonshot.responses("kimi-k3"),
  // @ts-expect-error Responses uses reasoningEffort rather than the Messages effort option.
  providerOptions: { effort: "high" },
})
