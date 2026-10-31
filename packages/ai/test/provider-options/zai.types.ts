import { ZAI, ZAICodingPlan } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

LLMRequest.from({
  model: ZAI.chat("glm-5.3"),
  providerOptions: { thinking: { clear_thinking: false }, reasoningEffort: "max" },
})
LLMRequest.from({
  model: ZAI.chat("glm-5.2"),
  providerOptions: { thinking: { type: "disabled" }, toolStream: false, responseFormat: { type: "json_object" } },
})
LLMRequest.from({
  model: ZAICodingPlan.messages("glm-5.3"),
  providerOptions: { thinking: { type: "enabled" }, effort: "high" },
})
LLMRequest.from({ model: ZAICodingPlan.responses("glm-5.3"), providerOptions: { reasoningEffort: "future-effort" } })

LLMRequest.from({
  model: ZAI.chat("glm-5.3"),
  // @ts-expect-error clear_thinking is a boolean.
  providerOptions: { thinking: { clear_thinking: "false" } },
})
LLMRequest.from({
  model: ZAICodingPlan.messages("glm-5.3"),
  // @ts-expect-error Messages uses effort.
  providerOptions: { reasoningEffort: "high" },
})
LLMRequest.from({
  model: ZAICodingPlan.responses("glm-5.3"),
  // @ts-expect-error Responses uses reasoning effort, not Chat thinking controls.
  providerOptions: { thinking: { type: "enabled" } },
})
