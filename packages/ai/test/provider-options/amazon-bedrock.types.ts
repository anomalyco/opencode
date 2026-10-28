import { LLM } from "../../src/effect.js"
import { AmazonBedrock } from "../../src/providers.js"

const model = AmazonBedrock.provider.model("us.anthropic.claude-sonnet-4-6")

LLM.request({
  model,
  prompt: "Hello",
  providerOptions: {
    effort: "future-effort",
    serviceTier: "future-tier",
    thinking: { type: "adaptive", display: "future-display" },
    guardrail: { identifier: "abc123", version: "DRAFT", trace: "future-trace", streamProcessingMode: "future-mode" },
    outputFormat: { type: "future-format", schema: { type: "object" } },
    requestMetadata: { suite: "opencode-ai" },
  },
})

AmazonBedrock.model("us.amazon.nova-2-lite-v1:0", { effort: "low", serviceTier: "flex" })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Bedrock thinking modes are a fixed union.
  providerOptions: { thinking: { type: "automatic" } },
})

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Converse request metadata values are strings.
  providerOptions: { requestMetadata: { attempt: 1 } },
})
