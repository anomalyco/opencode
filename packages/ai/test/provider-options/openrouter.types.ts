import { LLM } from "../../src"
import { OpenRouter } from "../../src/providers"

const model = OpenRouter.provider.model("anthropic/claude-sonnet-4.5")

LLM.request({ model, prompt: "Hello", providerOptions: { openrouter: { usage: true } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenRouter usage must be boolean or an option record.
  providerOptions: { openrouter: { usage: "yes" } },
})
