import { ai } from "../../src/effect.js"
import { VercelAIGateway } from "../../src/providers/vercel-ai-gateway.js"

const settings = {
  apiKey: "fixture",
  gateway: { only: ["anthropic", "bedrock"], caching: "auto" },
  reasoningEffort: "high",
} as const
ai.request({
  model: VercelAIGateway.model("meta/muse-spark-1.3", settings),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "max" },
})
ai.request({
  model: VercelAIGateway.messagesModel("anthropic/claude-sonnet-5.5", settings),
  prompt: "Hello",
  providerOptions: { thinking: { type: "enabled", budgetTokens: 2048 } },
})
ai.request({
  model: VercelAIGateway.responsesModel("openai/gpt-6-luna", settings),
  prompt: "Hello",
  providerOptions: { reasoningSummary: "detailed", cacheTTL: "1h" },
})
VercelAIGateway.model("google/gemini-3.8-flash", {
  gateway: { byok: { anthropic: [{ apiKey: "fixture" }] } },
  upstream: { google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 } } },
})
// @ts-expect-error A thinking budget is numeric.
VercelAIGateway.model("anthropic/claude-sonnet-5.5", { thinking: { type: "enabled", budgetTokens: "many" } })
