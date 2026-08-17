import { LLM } from "../../src/index.js"
import { Anthropic } from "../../src/providers.js"

const model = Anthropic.provider.model("claude-sonnet-4-5")

LLM.request({ model, prompt: "Hello", providerOptions: { anthropic: { thinking: { type: "adaptive" } } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Anthropic thinking modes are a fixed union.
  providerOptions: { anthropic: { thinking: { type: "automatic" } } },
})
