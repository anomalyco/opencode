import { LLM } from "../../src/index.js"
import { Moonshot } from "../../src/providers.js"

const moonshot = Moonshot.configure()

LLM.request({ model: moonshot.model("kimi-k2.6"), providerOptions: { thinking: { type: "enabled", keep: "all" } } })
LLM.request({ model: moonshot.chat("kimi-k2.6"), providerOptions: { thinking: { type: "disabled", keep: null } } })
LLM.request({ model: moonshot.chat("kimi-k3"), providerOptions: { reasoningEffort: "high" } })
LLM.request({
  model: moonshot.messages("kimi-k3"),
  providerOptions: { effort: "low", metadata: { user_id: "fixture" } },
})
LLM.request({ model: moonshot.responses("kimi-k3"), providerOptions: { reasoningEffort: "future-effort" } })

LLM.request({
  model: moonshot.messages("kimi-k3"),
  // @ts-expect-error Messages exposes effort rather than the K2 Chat thinking parameter.
  providerOptions: { thinking: { type: "enabled" } },
})
LLM.request({
  model: moonshot.chat("kimi-k2.6"),
  // @ts-expect-error Preserved thinking takes a string or null.
  providerOptions: { thinking: { type: "enabled", keep: true } },
})
LLM.request({
  model: moonshot.responses("kimi-k3"),
  // @ts-expect-error Responses uses reasoningEffort rather than the Messages effort option.
  providerOptions: { effort: "high" },
})
