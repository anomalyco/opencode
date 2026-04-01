import { map, pipe, sortBy } from "remeda"

const priority: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

type Row = {
  title: string
  value: string
  description?: string
  category: string
}

export function providerList(list: { id: string; name: string }[]): Row[] {
  return [
    ...pipe(
      list,
      sortBy((x) => priority[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          opencode: "(Recommended)",
          anthropic: "(API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
          "opencode-go": "Low cost subscription for everyone",
        }[provider.id],
        category: provider.id in priority ? "Popular" : "Providers",
      })),
    ),
    {
      title: "Other",
      value: "other",
      description: "Custom provider",
      category: "Providers",
    },
  ]
}
