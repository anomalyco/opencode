import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"

function Free() {
  const { theme } = useTheme()
  return <span style={{ fg: theme.secondary }}>Free</span>
}

export function DialogModel() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()

  const options = createMemo(() => {
    const query = ref()?.filter
    const favorites = local.model.favorite()
    const recents = local.model.recent()
    const currentModel = local.model.current()

    const orderedRecents = currentModel
      ? [
          currentModel,
          ...recents.filter(
            (item) => item.providerID !== currentModel.providerID || item.modelID !== currentModel.modelID,
          ),
        ]
      : recents

    const favoriteList = favorites.filter(
      (item) =>
        !orderedRecents.some((recent) => recent.providerID === item.providerID && recent.modelID === item.modelID),
    )

    const favoriteOptions = !query
      ? favoriteList.flatMap((item) => {
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
              title: `${model.name ?? item.modelID}`,
              description: `${provider.name} ★`,
              category: "Favorites",
              footer: model.cost?.input === 0 && provider.id === "opencode" ? <Free /> : undefined,
            },
          ]
        })
      : []

    const recentOptions = !query
      ? orderedRecents.flatMap((item) => {
          const provider = sync.data.provider.find((x) => x.id === item.providerID)
          if (!provider) return []
          const model = provider.models[item.modelID]
          if (!model) return []
          const favorite = favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID)
          return [
            {
              key: item,
              value: {
                providerID: provider.id,
                modelID: model.id,
              },
              title: `${model.name ?? item.modelID}`,
              description: `${provider.name}${favorite ? " ★" : ""}`,
              category: "Recent",
              footer: model.cost?.input === 0 && provider.id === "opencode" ? <Free /> : undefined,
            },
          ]
        })
      : []

    return [
      ...recentOptions,
      ...favoriteOptions,
      ...pipe(
        sync.data.provider,
        sortBy(
          (provider) => provider.id !== "opencode",
          (provider) => provider.name,
        ),
        flatMap((provider) =>
          pipe(
            provider.models,
            entries(),
            map(([model, info]) => {
              const value = {
                providerID: provider.id,
                modelID: model,
              }
              const favorite = favorites.some(
                (item) => item.providerID === value.providerID && item.modelID === value.modelID,
              )
              return {
                value,
                title: `${info.name ?? model}`,
                description: `${provider.name}${favorite ? " ★" : ""}`,
                category: provider.name,
                footer: info.cost?.input === 0 && provider.id === "opencode" ? <Free /> : undefined,
              }
            }),
            filter((x) => {
              if (query) return true
              const value = x.value
              const inFavorites = favorites.some(
                (item) => item.providerID === value.providerID && item.modelID === value.modelID,
              )
              const inRecents = orderedRecents.some(
                (item) => item.providerID === value.providerID && item.modelID === value.modelID,
              )
              if (inFavorites) return false
              if (inRecents) return false
              return true
            }),
            sortBy((x) => x.title),
          ),
        ),
      ),
    ]
  })

  return (
    <DialogSelect
      ref={setRef}
      title="Select model"
      current={local.model.current()}
      options={options()}
      onSelect={(option) => {
        dialog.clear()
        local.model.set(option.value, { recent: true })
      }}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "favorite",
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value)
          },
        },
      ]}
    />
  )
}
