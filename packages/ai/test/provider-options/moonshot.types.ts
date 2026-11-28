import { ai } from "../../src/effect.js"
import { Moonshot } from "../../src/providers/moonshot.js"

ai.request({
  model: Moonshot.model("kimi-k2.6"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "enabled", keep: "all" } },
})
ai.request({
  model: Moonshot.model("kimi-k2.6"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "disabled", keep: null } },
})
ai.request({ model: Moonshot.model("kimi-k3"), prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
ai.request({
  model: Moonshot.messagesModel("kimi-k3"),
  prompt: "Hello",
  providerOptions: { effort: "low", metadata: { user_id: "fixture" } },
})
ai.request({
  model: Moonshot.responsesModel("kimi-k3"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "future-effort" },
})

ai.request({
  model: Moonshot.messagesModel("kimi-k3"),
  prompt: "Hello",
  // @ts-expect-error Messages exposes effort rather than the K2 Chat thinking parameter.
  providerOptions: { thinking: { type: "enabled" } },
})
ai.request({
  model: Moonshot.model("kimi-k2.6"),
  prompt: "Hello",
  // @ts-expect-error Preserved thinking takes a string or null.
  providerOptions: { thinking: { type: "enabled", keep: true } },
})
ai.request({
  model: Moonshot.responsesModel("kimi-k3"),
  prompt: "Hello",
  // @ts-expect-error Responses uses reasoningEffort rather than the Messages effort option.
  providerOptions: { effort: "high" },
})
