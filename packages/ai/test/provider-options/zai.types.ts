import { ai } from "../../src/effect.js"
import { ZAI } from "../../src/providers/zai.js"
import { ZAICodingPlan } from "../../src/providers/zai-coding-plan.js"

ai.request({
  model: ZAI.model("glm-5.3"),
  prompt: "Hello",
  providerOptions: { thinking: { clear_thinking: false }, reasoningEffort: "max" },
})
ai.request({
  model: ZAI.model("glm-5.2"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "disabled" }, toolStream: false, responseFormat: { type: "json_object" } },
})
ai.request({
  model: ZAICodingPlan.messagesModel("glm-5.3"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "enabled" }, effort: "high" },
})
ai.request({
  model: ZAICodingPlan.responsesModel("glm-5.3"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "future-effort" },
})

ai.request({
  model: ZAI.model("glm-5.3"),
  prompt: "Hello",
  // @ts-expect-error clear_thinking is a boolean.
  providerOptions: { thinking: { clear_thinking: "false" } },
})
ai.request({
  model: ZAICodingPlan.messagesModel("glm-5.3"),
  prompt: "Hello",
  // @ts-expect-error Messages uses effort.
  providerOptions: { reasoningEffort: "high" },
})
ai.request({
  model: ZAICodingPlan.responsesModel("glm-5.3"),
  prompt: "Hello",
  // @ts-expect-error Responses uses reasoning effort, not Chat thinking controls.
  providerOptions: { thinking: { type: "enabled" } },
})
