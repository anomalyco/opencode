import { LLM } from "../../src/index.js"
import { Google } from "../../src/providers.js"

const model = Google.provider.model("gemini-2.5-pro")

LLM.request({
  model,
  prompt: "Hello",
  providerOptions: { gemini: { thinkingConfig: { thinkingBudget: 1024 } } },
})

LLM.request({
  model,
  prompt: "Hello",
  providerOptions: {
    gemini: {
      // @ts-expect-error Gemini safety settings require a threshold for every category.
      safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH" }],
    },
  },
})

LLM.request({
  model,
  prompt: "Hello",
  providerOptions: {
    gemini: {
      cachedContent: "cachedContents/example",
      safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" }],
      serviceTier: "future-tier",
      thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
    },
  },
})

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Gemini thinking budgets must be numeric.
  providerOptions: { gemini: { thinkingConfig: { thinkingBudget: "large" } } },
})

LLM.request({
  model,
  prompt: "Hello",
  providerOptions: { gemini: { thinkingConfig: { thinkingLevel: "maximum" } } },
})
