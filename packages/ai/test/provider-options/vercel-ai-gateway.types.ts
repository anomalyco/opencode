import { ai } from "../../src/effect.js"
import { vercelAIGateway } from "../../src/providers/vercel-ai-gateway.js"

const gateway = vercelAIGateway.configure({
  apiKey: "fixture",
  providerOptions: { gateway: { only: ["anthropic", "bedrock"], caching: "auto" }, reasoningEffort: "high" },
})
ai.request({
  model: gateway("meta/muse-spark-1.3"),
  prompt: "Hello",
  providerOptions: { reasoningEffort: "max" },
})
ai.request({
  model: gateway.messages("anthropic/claude-sonnet-5.5"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "enabled", budgetTokens: 2048 } },
})
ai.request({
  model: gateway.responses("openai/gpt-6-luna"),
  prompt: "Hello",
  providerOptions: { reasoningSummary: "detailed", cacheTTL: "1h" },
})
vercelAIGateway.configure({
  providerOptions: {
    gateway: { byok: { anthropic: [{ apiKey: "fixture" }] } },
    upstream: { google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 } } },
  },
})
// @ts-expect-error A thinking budget is numeric.
vercelAIGateway.configure({ providerOptions: { thinking: { type: "enabled", budgetTokens: "many" } } })
