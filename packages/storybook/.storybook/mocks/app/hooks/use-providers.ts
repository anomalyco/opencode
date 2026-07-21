const model_id = "claude-3-7-sonnet"

export const popularProviders = [
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]

const provider = {
  id: "anthropic",
  name: "Anthropic",
  models: {
    [model_id]: {
      id: model_id,
      name: "Claude 3.7 Sonnet",
      cost: { input: 1, output: 1 },
      variants: { fast: {}, thinking: {} },
    },
  },
}

const popular = [
  { id: "opencode", name: "OpenCode Zen", models: {} },
  { id: "opencode-go", name: "OpenCode Go", models: {} },
  { id: "openai", name: "OpenAI", models: {} },
  provider,
  { id: "google", name: "Google", models: {} },
  { id: "github-copilot", name: "GitHub Copilot", models: {} },
]

const catalog = [
  ...popular,
  { id: "openrouter", name: "OpenRouter", models: {} },
  { id: "vercel", name: "Vercel AI Gateway", models: {} },
  { id: "302ai", name: "302.AI", models: {} },
  { id: "abacus", name: "Abacus", models: {} },
  { id: "abliteration", name: "abliteration.ai", models: {} },
  { id: "alibaba", name: "Alibaba", models: {} },
  { id: "alibaba-cn", name: "Alibaba (China)", models: {} },
  { id: "alibaba-coding-plan", name: "Alibaba Coding Plan", models: {} },
]

export function useProviders() {
  return {
    all: () => new Map(catalog.map((item) => [item.id, item])),
    default: () => ({ anthropic: model_id }),
    connected: () => [provider],
    paid: () => [provider],
    popular: () => popular,
  }
}
