import type { Accessor } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { useProviders } from "../../../../app/src/providers/catalog/providers"

export { popularProviders, syncWhileBooting } from "../../../../app/src/providers/catalog/providers"

export { useStoryProviders as useProviders }

const model_id = "claude-3-7-sonnet"

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
  { id: "opencode-go", name: "OpenCode Go", models: {} },
  { id: "opencode", name: "OpenCode Zen", models: {} },
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

function useStoryProviders(directory: Accessor<string | undefined> = () => undefined) {
  const server = useServer()

  if ("sdk" in server.ctx) return useProviders(directory)

  return {
    ready: () => true,
    all: () => new Map(catalog.map((item) => [item.id, item])),
    default: () => ({ anthropic: model_id }),
    connected: () => [provider],
    anyConnection: () => true,
    paid: () => [provider],
    popular: () => popular,
  }
}
