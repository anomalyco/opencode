import { LLM } from "../../src"
import { Google } from "../../src/providers"

const model = Google.provider.model("gemini-2.5-pro")

LLM.request({
  model,
  prompt: "Hello",
  providerOptions: { gemini: { thinkingConfig: { thinkingBudget: 1024 } } },
})

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Gemini thinking budgets must be numeric.
  providerOptions: { gemini: { thinkingConfig: { thinkingBudget: "large" } } },
})
