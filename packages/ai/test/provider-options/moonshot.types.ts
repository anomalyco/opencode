import { ai } from "../../src/effect.js"
import { Moonshot } from "../../src/providers.js"

const moonshot = Moonshot.configure()

ai.request({ model: moonshot.model("kimi-k2.6"), providerOptions: { thinking: { type: "enabled", keep: "all" } } })
ai.request({ model: moonshot.chat("kimi-k2.6"), providerOptions: { thinking: { type: "disabled", keep: null } } })
ai.request({ model: moonshot.chat("kimi-k3"), providerOptions: { reasoningEffort: "high" } })
ai.request({
  model: moonshot.messages("kimi-k3"),
  providerOptions: { effort: "low", metadata: { user_id: "fixture" } },
})
ai.request({ model: moonshot.responses("kimi-k3"), providerOptions: { reasoningEffort: "future-effort" } })

ai.request({
  model: moonshot.messages("kimi-k3"),
  // @ts-expect-error Messages exposes effort rather than the K2 Chat thinking parameter.
  providerOptions: { thinking: { type: "enabled" } },
})
ai.request({
  model: moonshot.chat("kimi-k2.6"),
  // @ts-expect-error Preserved thinking takes a string or null.
  providerOptions: { thinking: { type: "enabled", keep: true } },
})
ai.request({
  model: moonshot.responses("kimi-k3"),
  // @ts-expect-error Responses uses reasoningEffort rather than the Messages effort option.
  providerOptions: { effort: "high" },
})
