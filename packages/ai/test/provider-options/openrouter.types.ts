import { ai } from "../../src/effect.js"
import { OpenRouter } from "../../src/providers.js"

const model = OpenRouter.provider.model("anthropic/claude-sonnet-4.5")

ai.request({ model, prompt: "Hello", providerOptions: { usage: true } })

ai.request({
  model,
  prompt: "Hello",
  providerOptions: {
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
})

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error OpenRouter usage must be boolean or an option record.
  providerOptions: { usage: "yes" },
})

const responses = OpenRouter.provider.responses("openai/gpt-5.4")

ai.request({
  model: responses,
  prompt: "Hello",
  providerOptions: {
    reasoningEffort: "low",
    models: ["openai/gpt-5.4-mini"],
    provider: { only: ["openai"], sort: "future-sort", data_collection: "future-policy" },
    plugins: [{ id: "future-plugin", enabled: true }],
    debug: { echo_upstream_body: true },
    user: "user_123",
  },
})

ai.request({
  model: responses,
  prompt: "Hello",
  // @ts-expect-error OpenRouter fallback models must be a list of model IDs.
  providerOptions: { models: "openai/gpt-5.4-mini" },
})
