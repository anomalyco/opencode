import { ai } from "../../src/effect.js"
import { Alibaba } from "../../src/providers.js"

const location = { region: "ap-southeast-1" }
const provider = {
  chat: (id: string) => Alibaba.model(id, location),
  messages: (id: string) => Alibaba.messagesModel(id, location),
  responses: (id: string) => Alibaba.responsesModel(id, location),
}
Alibaba.model("qwen3.8-max", { baseURL: "https://gateway.example/v1" })
Alibaba.model("qwen3.8-max", { region: "eu-central-1", workspaceID: "llm-workspace" })
ai.request({
  model: provider.chat("qwen3.8-max"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "future", enableThinking: true, preserveThinking: false, toolStream: true },
})
ai.request({
  model: provider.messages("qwen3.8-max"),
  prompt: "Hello",
  providerOptions: { effort: "xhigh", thinking: { type: "enabled" } },
})
ai.request({
  model: provider.messages("qwen3.7-plus"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "enabled", budgetTokens: 512 } },
})
ai.request({
  model: provider.responses("qwen3.8-max"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "low", enableThinking: true, store: true, previousResponseId: "resp_previous" },
})
// @ts-expect-error Region or complete base URL is required.
Alibaba.model("qwen3.8-max", { apiKey: "fixture" })
ai.request({
  model: provider.chat("qwen3.8-max"),
  prompt: "Hello",
  // @ts-expect-error Thinking toggle is a boolean.
  providerOptions: { enableThinking: "true" },
})
ai.request({
  model: provider.messages("qwen3.8-max"),
  prompt: "Hello",
  // @ts-expect-error Messages uses effort.
  providerOptions: { reasoningEffort: "high" },
})
ai.request({
  model: provider.responses("qwen3.8-max"),
  prompt: "Hello",
  // @ts-expect-error Responses does not use Chat thinking budgets.
  providerOptions: { thinkingBudget: 512 },
})
