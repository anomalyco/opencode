import { createMemo, createSignal, onCleanup } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { Keybind } from "@/util/keybind"
import * as fuzzysort from "fuzzysort"

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
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [query, setQuery] = createSignal("")

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  const setQueryDebounced = (value: string) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => setQuery(value), 50)
  }
  onCleanup(() => debounceTimer && clearTimeout(debounceTimer))

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => {
    if (!connected()) return false
    if (props.providerID) return false
    return true
  })

  function selectModel(providerID: string, modelID: string) {
    dialog.clear()
    local.model.set({ providerID, modelID }, { recent: true })
  }

  const baseOptions = createMemo(() => {
    const favorites = showExtra() ? local.model.favorite() : []
    const recents = local.model.recent()

    const recentList = showExtra()
      ? recents.filter(
          (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
        )
      : []

    const favoriteOptions = favorites.flatMap((item) => {
      const provider = sync.data.provider.find((x) => x.id === item.providerID)
      if (!provider) return []
      const model = provider.models[item.modelID]
      if (!model) return []
      const providerID = provider.id
      const modelID = model.id
      return [
        {
          key: item,
          value: { providerID, modelID },
          title: model.name ?? item.modelID,
          description: provider.name,
          category: "Favorites",
          disabled: providerID === "opencode" && modelID.includes("-nano"),
          footer: model.cost?.input === 0 && providerID === "opencode" ? "Free" : undefined,
          onSelect: () => selectModel(providerID, modelID),
        },
      ]
    })

    const recentOptions = recentList.flatMap((item) => {
      const provider = sync.data.provider.find((x) => x.id === item.providerID)
      if (!provider) return []
      const model = provider.models[item.modelID]
      if (!model) return []
      const providerID = provider.id
      const modelID = model.id
      return [
        {
          key: item,
          value: { providerID, modelID },
          title: model.name ?? item.modelID,
          description: provider.name,
          category: "Recent",
          disabled: providerID === "opencode" && modelID.includes("-nano"),
          footer: model.cost?.input === 0 && providerID === "opencode" ? "Free" : undefined,
          onSelect: () => selectModel(providerID, modelID),
        },
      ]
    })

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([modelID, info]) => {
            const providerID = provider.id
            const value = { providerID, modelID }
            return {
              value,
              title: info.name ?? modelID,
              description: favorites.some((item) => item.providerID === providerID && item.modelID === modelID)
                ? "(Favorite)"
                : undefined,
              category: connected() ? provider.name : undefined,
              disabled: providerID === "opencode" && modelID.includes("-nano"),
              footer: info.cost?.input === 0 && providerID === "opencode" ? "Free" : undefined,
              onSelect: () => selectModel(providerID, modelID),
            }
          }),
          filter((x) => {
            const { providerID, modelID } = x.value
            const inFavorites = favorites.some((item) => item.providerID === providerID && item.modelID === modelID)
            if (inFavorites) return false
            const inRecents = recentList.some((item) => item.providerID === providerID && item.modelID === modelID)
            if (inRecents) return false
            return true
          }),
          sortBy(
            (x) => x.footer !== "Free",
            (x) => x.title,
          ),
        ),
      ),
    )

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

    return { favoriteOptions, recentOptions, providerOptions, popularProviders }
  })

  const options = createMemo(() => {
    const q = query()
    const { favoriteOptions, recentOptions, providerOptions, popularProviders } = baseOptions()

    if (q) {
      const filteredFavorites = fuzzysort.go(q, favoriteOptions, { keys: ["title"] }).map((x) => x.obj)
      const filteredRecents = fuzzysort
        .go(q, recentOptions, { keys: ["title"] })
        .map((x) => x.obj)
        .slice(0, 5)
      const filteredProviders = fuzzysort.go(q, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
      const filteredPopular = fuzzysort.go(q, popularProviders, { keys: ["title"] }).map((x) => x.obj)
      return [...filteredFavorites, ...filteredRecents, ...filteredProviders, ...filteredPopular]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    if (provider()) return provider()!.name
    return "Select model"
  })

  return (
    <DialogSelect
      keybind={[
        {
          keybind: Keybind.parse("ctrl+a")[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      ref={setRef}
      onFilter={setQueryDebounced}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      options={options()}
    />
  )
}
