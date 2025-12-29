import { createMemo, createSignal } from "solid-js"
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
  const [showLatestOnly, setShowLatestOnly] = createSignal(true)

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => {
    if (!connected()) return false
    if (props.providerID) return false
    return true
  })

  const options = createMemo(() => {
    const q = query()
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
      return [
        {
          key: item,
          value: {
            providerID: provider.id,
            modelID: model.id,
          },
          title: model.name ?? item.modelID,
          description: provider.name,
          category: "Favorites",
          disabled: provider.id === "opencode" && model.id.includes("-nano"),
          footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
          onSelect: () => {
            dialog.clear()
            local.model.set(
              {
                providerID: provider.id,
                modelID: model.id,
              },
              { recent: true },
            )
          },
        },
      ]
    })

    const recentOptions = recentList.flatMap((item) => {
      const provider = sync.data.provider.find((x) => x.id === item.providerID)
      if (!provider) return []
      const model = provider.models[item.modelID]
      if (!model) return []
      return [
        {
          key: item,
          value: {
            providerID: provider.id,
            modelID: model.id,
          },
          title: model.name ?? item.modelID,
          description: provider.name,
          category: "Recent",
          disabled: provider.id === "opencode" && model.id.includes("-nano"),
          footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
          onSelect: () => {
            dialog.clear()
            local.model.set(
              {
                providerID: provider.id,
                modelID: model.id,
              },
              { recent: true },
            )
          },
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
          // Filter out dated model versions when "show latest only" is enabled
          filter(([model, _]) => !showLatestOnly() || !model.match(/-\d{8}$/)),
          map(([model, info]) => {
            const value = {
              providerID: provider.id,
              modelID: model,
            }
            // Extract date suffix from model ID (e.g., "20251101" from "claude-opus-4-5-20251101")
            const dateMatch = model.match(/-(\d{8})$/)
            let title = info.name ?? model
            // If model has a date suffix and title doesn't already include it, append it
            if (dateMatch && !title.includes(dateMatch[1])) {
              title = `${title} (${dateMatch[1]})`
            }
            // If model doesn't have a date suffix and title doesn't say "latest", mark it as latest
            else if (!dateMatch && !title.toLowerCase().includes("latest")) {
              title = `${title} (latest)`
            }
            return {
              value,
              title,
              description: favorites.some(
                (item) => item.providerID === value.providerID && item.modelID === value.modelID,
              )
                ? "(Favorite)"
                : undefined,
              category: connected() ? provider.name : undefined,
              disabled: provider.id === "opencode" && model.includes("-nano"),
              footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
              onSelect() {
                dialog.clear()
                local.model.set(
                  {
                    providerID: provider.id,
                    modelID: model,
                  },
                  { recent: true },
                )
              },
            }
          }),
          filter((x) => {
            const value = x.value
            const inFavorites = favorites.some(
              (item) => item.providerID === value.providerID && item.modelID === value.modelID,
            )
            if (inFavorites) return false
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
          map((option) => {
            return {
              ...option,
              category: "Popular providers",
            }
          }),
          take(6),
        )
      : []

    // Apply fuzzy filtering to each section separately, maintaining section order
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
        {
          keybind: Keybind.parse("ctrl+l")[0],
          title: showLatestOnly() ? "Show all versions" : "Show latest only",
          disabled: !connected(),
          onTrigger: () => {
            setShowLatestOnly(!showLatestOnly())
          },
        },
      ]}
      ref={setRef}
      onFilter={setQuery}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      options={options()}
    />
  )
}
