import { LLM } from "../../src/index.js"
import { ZAI, ZAICodingPlan } from "../../src/providers.js"

LLM.request({
  model: ZAI.chat("glm-5.3"),
  providerOptions: { thinking: { clear_thinking: false }, reasoningEffort: "max" },
})
LLM.request({
  model: ZAI.chat("glm-5.2"),
  providerOptions: { thinking: { type: "disabled" }, toolStream: false, responseFormat: { type: "json_object" } },
})
LLM.request({
  model: ZAICodingPlan.messages("glm-5.3"),
  providerOptions: { thinking: { type: "enabled" }, effort: "high" },
})
LLM.request({ model: ZAICodingPlan.responses("glm-5.3"), providerOptions: { reasoningEffort: "future-effort" } })

LLM.request({
  model: ZAI.chat("glm-5.3"),
  // @ts-expect-error clear_thinking is a boolean.
  providerOptions: { thinking: { clear_thinking: "false" } },
})
LLM.request({
  model: ZAICodingPlan.messages("glm-5.3"),
  // @ts-expect-error Messages uses effort.
  providerOptions: { reasoningEffort: "high" },
})
LLM.request({
  model: ZAICodingPlan.responses("glm-5.3"),
  // @ts-expect-error Responses uses reasoning effort, not Chat thinking controls.
  providerOptions: { thinking: { type: "enabled" } },
})
