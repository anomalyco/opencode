const fallback = {
  openai: {
    api: "https://api.openai.com/v1",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    id: "openai",
    npm: "@ai-sdk/openai",
    models: {
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        release_date: "2024-06-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: {
          input: 0.00015,
          output: 0.0006,
        },
        limit: {
          context: 128000,
          output: 4096,
        },
        modalities: {
          input: ["text"],
          output: ["text"],
        },
        status: "beta",
        options: {},
      },
    },
  },
  anthropic: {
    api: "https://api.anthropic.com",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    id: "anthropic",
    npm: "@ai-sdk/anthropic",
    models: {
      "claude-3-5-sonnet": {
        id: "claude-3-5-sonnet",
        name: "Claude 3.5 Sonnet",
        release_date: "2024-07-01",
        attachment: false,
        reasoning: true,
        temperature: true,
        tool_call: true,
        cost: {
          input: 0.0003,
          output: 0.0015,
        },
        limit: {
          context: 200000,
          output: 4096,
        },
        modalities: {
          input: ["text"],
          output: ["text"],
        },
        status: "beta",
        options: {},
      },
    },
  },
}

export async function data() {
  const json = await fetch("https://models.dev/api.json")
    .then((x) => x.text())
    .catch(() => undefined)
  if (json) return json
  return JSON.stringify(fallback)
}
