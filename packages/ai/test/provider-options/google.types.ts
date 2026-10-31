import { Google } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = Google.provider.model("gemini-2.5-pro")

LLMRequest.from({
  model,
  prompt: "Hello",
  providerOptions: { thinkingConfig: { thinkingBudget: 1024 } },
})

LLMRequest.from({
  model,
  prompt: "Hello",
  providerOptions: {
    // @ts-expect-error Gemini safety settings require a threshold for every category.
    safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH" }],
  },
})

LLMRequest.from({
  model,
  prompt: "Hello",
  providerOptions: {
    cachedContent: "cachedContents/example",
    safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" }],
    serviceTier: "future-tier",
    thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
  },
})

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error Gemini thinking budgets must be numeric.
  providerOptions: { thinkingConfig: { thinkingBudget: "large" } },
})

LLMRequest.from({
  model,
  prompt: "Hello",
  providerOptions: { thinkingConfig: { thinkingLevel: "maximum" } },
})
