import { map, pipe, flatMap, entries, filter, sortBy } from "remeda"

export type ModelRef = {
  providerID: string
  modelID: string
}

export type ModelInfo = {
  id: string
  name?: string
  providerID?: string
  status?: string
  cost?: {
    input?: number
  }
}

export type ProviderInfo = {
  id: string
  name: string
  models: Record<string, ModelInfo>
}

export function buildSectionOptions(input: {
  items: ModelRef[]
  category: string
  providers: ProviderInfo[]
  showSections: boolean
}) {
  if (!input.showSections) return []
  return input.items.flatMap((item) => {
    const provider = input.providers.find((x) => x.id === item.providerID)
    if (!provider) return []
    const model = provider.models[item.modelID]
    if (!model) return []
    return [
      {
        key: item,
        value: { providerID: provider.id, modelID: model.id, section: input.category },
        title: model.name ?? item.modelID,
        description: provider.name,
        category: input.category,
        disabled: provider.id === "opencode" && model.id.includes("-nano"),
        footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
      },
    ]
  })
}

export function buildProviderOptions(input: {
  providers: ProviderInfo[]
  favorites: ModelRef[]
  connected: boolean
  providerID?: string
}) {
  return pipe(
    input.providers,
    sortBy(
      (provider) => provider.id !== "opencode",
      (provider) => provider.name,
    ),
    flatMap((provider) =>
      pipe(
        provider.models,
        entries(),
        filter(([_, info]) => info.status !== "deprecated"),
        filter(([_, info]) => (input.providerID ? info.providerID === input.providerID : true)),
        map(([model, info]) => ({
          value: { providerID: provider.id, modelID: model },
          title: info.name ?? model,
          description: input.favorites.some((item) => item.providerID === provider.id && item.modelID === model)
            ? "(Favorite)"
            : undefined,
          category: input.connected ? provider.name : undefined,
          disabled: provider.id === "opencode" && model.includes("-nano"),
          footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
        })),
        sortBy(
          (x) => x.footer !== "Free",
          (x) => x.title,
        ),
      ),
    ),
  )
}
