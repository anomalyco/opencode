import { LLM } from "../../src"
import { GitHubCopilot } from "../../src/providers"

const model = GitHubCopilot.configure({ baseURL: "https://example.com" }).model("gpt-5")

LLM.request({ model, prompt: "Hello", providerOptions: { openai: { reasoningSummary: "auto" } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Copilot reasoning summaries use the OpenAI union.
  providerOptions: { openai: { reasoningSummary: "full" } },
})
