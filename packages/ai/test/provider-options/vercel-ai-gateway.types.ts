import { LLM } from "../../src/index.js"
import { VercelAIGateway } from "../../src/providers/vercel-ai-gateway.js"

const gateway = VercelAIGateway.configure({
  apiKey: "fixture",
  providerOptions: { gateway: { only: ["anthropic", "bedrock"], caching: "auto" }, reasoningEffort: "high" },
})
LLM.request({
  model: gateway.model("meta/muse-spark-1.3"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "max" },
})
LLM.request({
  model: gateway.messages("anthropic/claude-sonnet-5.5"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "enabled", budgetTokens: 2048 } },
})
LLM.request({
  model: gateway.responses("openai/gpt-6-luna"),
  prompt: "Hello",
  providerOptions: { reasoningSummary: "detailed", cacheTTL: "1h" },
})
VercelAIGateway.configure({
  providerOptions: {
    gateway: { byok: { anthropic: [{ apiKey: "fixture" }] } },
    upstream: { google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 } } },
  },
})
// @ts-expect-error A thinking budget is numeric.
VercelAIGateway.configure({ providerOptions: { thinking: { type: "enabled", budgetTokens: "many" } } })
