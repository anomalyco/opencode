import { ai } from "../../src/effect.js"
import { moonshot } from "../../src/providers.js"

const moonshotProvider = moonshot.configure()

ai.request({
  model: moonshotProvider("kimi-k2.6"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "enabled", keep: "all" } },
})
ai.request({
  model: moonshotProvider.chat("kimi-k2.6"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "disabled", keep: null } },
})
ai.request({ model: moonshotProvider.chat("kimi-k3"), prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
ai.request({
  model: moonshotProvider.messages("kimi-k3"),
  prompt: "Hello",
  providerOptions: { effort: "low", metadata: { user_id: "fixture" } },
})
ai.request({
  model: moonshotProvider.responses("kimi-k3"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "future-effort" },
})

ai.request({
  model: moonshotProvider.messages("kimi-k3"),
  prompt: "Hello",
  // @ts-expect-error Messages exposes effort rather than the K2 Chat thinking parameter.
  providerOptions: { thinking: { type: "enabled" } },
})
ai.request({
  model: moonshotProvider.chat("kimi-k2.6"),
  prompt: "Hello",
  // @ts-expect-error Preserved thinking takes a string or null.
  providerOptions: { thinking: { type: "enabled", keep: true } },
})
ai.request({
  model: moonshotProvider.responses("kimi-k3"),
  prompt: "Hello",
  // @ts-expect-error Responses uses reasoningEffort rather than the Messages effort option.
  providerOptions: { effort: "high" },
})
