import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { Keybind } from "@/util/keybind"

export function DialogModel() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()

  const connected = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )

  const providers = createDialogProviderOptions()

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

    const isCurrent = (item: { providerID: string; modelID: string }) =>
      currentModel && item.providerID === currentModel.providerID && item.modelID === currentModel.modelID

    const currentIsFavorite = currentModel && favorites.some((fav) => isCurrent(fav))

    const recentList = orderedRecents
      .filter((item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID))
      .slice(0, 5)

    const orderedFavorites = currentModel
      ? [...favorites.filter((item) => isCurrent(item)), ...favorites.filter((item) => !isCurrent(item))]
      : favorites

    const orderedRecentList =
      currentModel && !currentIsFavorite
        ? [...recentList.filter((item) => isCurrent(item)), ...recentList.filter((item) => !isCurrent(item))]
        : recentList

    const favoriteOptions =
      !query && favorites.length > 0
        ? orderedFavorites.flatMap((item) => {
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
                description: `${provider.name} ★`,
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
        : []

    const recentOptions = !query
      ? orderedRecentList.flatMap((item) => {
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
      : []

    return [
      ...favoriteOptions,
      ...recentOptions,
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
                title: info.name ?? model,
                description: connected() ? `${provider.name}${favorite ? " ★" : ""}` : undefined,
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
      ...(!connected()
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
        : []),
    ]
  })

  return (
    <DialogSelect
      keybind={[
        {
          keybind: { ctrl: true, name: "a", meta: false, shift: false, leader: false },
          title: connected() ? "Connect provider" : "More providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "Favorite",
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      ref={setRef}
      title="Select model"
      current={local.model.current()}
      options={options()}
    />
  )
}
