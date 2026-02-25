import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { useKeybind } from "../context/keybind"
import * as fuzzysort from "fuzzysort"

type ModelRef = {
  providerID: string
  modelID: string
}

type ModelInfo = {
  id: string
  name?: string
  providerID?: string
  status?: string
  cost?: {
    input?: number
  }
}

type ProviderInfo = {
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
        value: { providerID: provider.id, modelID: model.id },
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

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    const favoriteOptions = buildSectionOptions({
      items: favorites,
      category: "Favorites",
      providers: sync.data.provider,
      showSections,
    }).map((option) => ({
      ...option,
      onSelect: () => {
        dialog.clear()
        local.model.set(option.value, { recent: true })
      },
    }))

    const recentOptions = buildSectionOptions({
      items: recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      category: "Recent",
      providers: sync.data.provider,
      showSections,
    }).map((option) => ({
      ...option,
      onSelect: () => {
        dialog.clear()
        local.model.set(option.value, { recent: true })
      },
    }))

    const providerOptions = buildProviderOptions({
      providers: sync.data.provider,
      favorites,
      connected: connected(),
      providerID: props.providerID,
    }).map((option) => ({
      ...option,
      onSelect() {
        dialog.clear()
        local.model.set(option.value, { recent: true })
      },
    }))

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => provider()?.name ?? "Select model")

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      keybind={[
        {
          keybind: keybind.all.model_provider_list?.[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: keybind.all.model_favorite_toggle?.[0],
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}
