import { LLM } from "../../src"
import { OpenRouter } from "../../src/providers"

const model = OpenRouter.provider.model("anthropic/claude-sonnet-4.5")

LLM.request({ model, prompt: "Hello", providerOptions: { openrouter: { usage: true } } })

LLM.request({
  model,
  prompt: "Hello",
  providerOptions: {
    openrouter: {
      models: ["google/gemini-3.1-pro"],
      provider: {
        order: ["anthropic"],
        require_parameters: true,
        data_collection: "future-policy",
        sort: "future-sort",
        max_price: { prompt: "0.50" },
      },
      reasoning: { effort: "future-effort", exclude: false },
      plugins: [{ id: "future-plugin", enabled: true }],
      web_search_options: { engine: "future-engine" },
      debug: { echo_upstream_body: true },
      user: "user_123",
    },
  },
})

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenRouter usage must be boolean or an option record.
  providerOptions: { openrouter: { usage: "yes" } },
})
