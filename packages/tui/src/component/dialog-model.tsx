import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useSync } from "../context/sync"
import { useTuiConfig } from "../config"
import type { Provider } from "@opencode-ai/sdk/v2"

type ModelReference = { providerID: string; modelID: string }

type ModelPickerOption = DialogSelectOption<ModelReference | string> & { key?: ModelReference }

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")
  const tuiConfig = useTuiConfig()

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const options = createMemo(() => {
    return createModelPickerOptions({
      query: query(),
      connected: connected(),
      providerID: props.providerID,
      groupSearchResults: tuiConfig.model_picker.group_search_results,
      providers: sync.data.provider,
      favorites: connected() ? local.model.favorite() : [],
      recents: local.model.recent(),
      popularProviders: providers(),
      onSelect,
    })
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((item) => item.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={!tuiConfig.model_picker.group_search_results}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

export function createModelPickerOptions(input: {
  query: string
  connected: boolean
  providerID?: string
  groupSearchResults: boolean
  providers: Provider[]
  favorites: ModelReference[]
  recents: ModelReference[]
  popularProviders: ModelPickerOption[]
  onSelect: (providerID: string, modelID: string) => void
}) {
  const needle = input.query.trim()
  const showSections = input.connected && !input.providerID && (needle.length === 0 || input.groupSearchResults)

  function toOptions(items: ModelReference[], category: string): ModelPickerOption[] {
    if (!showSections) return []
    return items.flatMap((item) => {
      const provider = input.providers.find((provider) => provider.id === item.providerID)
      if (!provider) return []
      const model = provider.models[item.modelID]
      if (!model) return []
      return [
        {
          key: item,
          value: { providerID: provider.id, modelID: model.id },
          title: model.name ?? item.modelID,
          description: provider.name,
          category,
          disabled: provider.id === "opencode" && model.id.includes("-nano"),
          footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
          onSelect: () => {
            input.onSelect(provider.id, model.id)
          },
        },
      ]
    })
  }

  const favoriteOptions = toOptions(input.favorites, "Favorites")
  const recentOptions = toOptions(
    input.recents.filter(
      (item) => !input.favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
    ),
    "Recent",
  )

  const providerOptions = pipe(
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
          releaseDate: info.release_date,
          description: input.favorites.some((item) => item.providerID === provider.id && item.modelID === model)
            ? "(Favorite)"
            : undefined,
          category: input.connected ? provider.name : undefined,
          disabled: provider.id === "opencode" && model.includes("-nano"),
          footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
          onSelect() {
            input.onSelect(provider.id, model)
          },
        })),
        filter((option) => {
          if (!showSections) return true
          if (
            input.favorites.some(
              (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
            )
          )
            return false
          if (
            input.recents.some(
              (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
            )
          )
            return false
          return true
        }),
        (options) => sortModelOptions(options, input.providerID !== undefined),
      ),
    ),
  )

  const popularProviders = !input.connected
    ? pipe(
        input.popularProviders,
        map((option) => ({
          ...option,
          category: "Popular providers",
        })),
        take(6),
      )
    : []

  if (needle) {
    if (input.groupSearchResults) {
      return [
        ...fuzzysort.go(needle, favoriteOptions, { keys: ["title", "description"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, recentOptions, { keys: ["title", "description"] }).map((x) => x.obj),
        ...sortModelOptions(
          fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
          false,
        ),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }
    return [
      ...sortModelOptions(
        fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        false,
      ),
      ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
    ]
  }

  return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}
