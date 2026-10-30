import { ai } from "../../src/effect.js"
import { Google } from "../../src/providers.js"

const model = Google.provider.model("gemini-2.5-pro")

ai.request({
  model,
  prompt: "Hello",
  providerOptions: { thinkingConfig: { thinkingBudget: 1024 } },
})

ai.request({
  model,
  prompt: "Hello",
  providerOptions: {
    // @ts-expect-error Gemini safety settings require a threshold for every category.
    safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH" }],
  },
})

ai.request({
  model,
  prompt: "Hello",
  providerOptions: {
    cachedContent: "cachedContents/example",
    safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" }],
    serviceTier: "future-tier",
    thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
  },
})

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Gemini thinking budgets must be numeric.
  providerOptions: { thinkingConfig: { thinkingBudget: "large" } },
})

ai.request({
  model,
  prompt: "Hello",
  providerOptions: { thinkingConfig: { thinkingLevel: "maximum" } },
})
