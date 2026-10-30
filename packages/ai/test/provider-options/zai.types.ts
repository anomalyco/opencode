import { ai } from "../../src/effect.js"
import { ZAI, ZAICodingPlan } from "../../src/providers.js"

ai.text.request({
  model: ZAI.chat("glm-5.3"),
  providerOptions: { thinking: { clear_thinking: false }, reasoningEffort: "max" },
})
ai.text.request({
  model: ZAI.chat("glm-5.2"),
  providerOptions: { thinking: { type: "disabled" }, toolStream: false, responseFormat: { type: "json_object" } },
})
ai.text.request({
  model: ZAICodingPlan.messages("glm-5.3"),
  providerOptions: { thinking: { type: "enabled" }, effort: "high" },
})
ai.text.request({ model: ZAICodingPlan.responses("glm-5.3"), providerOptions: { reasoningEffort: "future-effort" } })

ai.text.request({
  model: ZAI.chat("glm-5.3"),
  // @ts-expect-error clear_thinking is a boolean.
  providerOptions: { thinking: { clear_thinking: "false" } },
})
ai.text.request({
  model: ZAICodingPlan.messages("glm-5.3"),
  // @ts-expect-error Messages uses effort.
  providerOptions: { reasoningEffort: "high" },
})
ai.text.request({
  model: ZAICodingPlan.responses("glm-5.3"),
  // @ts-expect-error Responses uses reasoning effort, not Chat thinking controls.
  providerOptions: { thinking: { type: "enabled" } },
})
