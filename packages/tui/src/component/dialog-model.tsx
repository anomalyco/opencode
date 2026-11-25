import type { ModelInfo } from "@opencode/client"
import { createMemo, createSignal, Show } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogIntegration } from "./dialog-integration"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useData } from "../context/data"
import { modelPreferenceKey } from "../model-preference"
import { useLocation } from "../context/location"
import { useNewDesigns } from "../config"
import { DialogFreeModels } from "./dialog-model-free"
import { FavoriteMarker, isFreeModel, prioritizeFavorites, sortModelOptions } from "./model-options"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const dialog = useDialog()
  const newDesigns = useNewDesigns()
  const connected = useConnected()

  function select(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.current()
    if (cur && list.includes(cur)) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  function connect() {
    dialog.replace(() => (
      <DialogIntegration onConnected={(providerID) => dialog.replace(() => <DialogModel providerID={providerID} />)} />
    ))
  }

  return (
    <Show
      when={newDesigns() && !connected() && !props.providerID}
      fallback={<DialogConnectedModels providerID={props.providerID} onSelect={select} onConnect={connect} />}
    >
      <DialogFreeModels onSelect={select} onConnect={connect} />
    </Show>
  )
}

function DialogConnectedModels(props: {
  providerID?: string
  onSelect: (providerID: string, modelID: string) => void
  onConnect: () => void
}) {
  const local = useLocal()
  const newDesigns = useNewDesigns()
  const data = useData()
  const location = useLocation()
  const [query, setQuery] = createSignal("")
  const searching = createMemo(() => query().trim().length > 0)
  // Under new designs, favoriting does not reorder the list until the dialog is reopened.
  const favoritesAtOpen = [...local.model.favorite()]
  const favoritePriority = new Set(favoritesAtOpen.map(modelPreferenceKey))
  const isFavorite = (value: { providerID: string; modelID: string } | undefined) =>
    value !== undefined &&
    local.model.favorite().some((item) => item.providerID === value.providerID && item.modelID === value.modelID)
  // Under new designs the detail row shows the price, so the trailing slot only marks favorites.
  const trailing = (model: ModelInfo, favorite: boolean) => {
    if (newDesigns()) return favorite ? <FavoriteMarker /> : undefined
    return isFreeModel(model) ? "Free" : undefined
  }
  // OpenCode's own free models get their own group at the end of the list instead of joining "OpenCode".
  const freeGroup = (model: ModelInfo) =>
    newDesigns() && !props.providerID && model.providerID === "opencode" && isFreeModel(model)

  const connected = useConnected()
  const providers = createMemo(
    () => new Map((data.location.provider.list(location.ref) ?? []).map((item) => [item.id, item])),
  )
  const models = createMemo(() => data.location.model.list(location.ref) ?? [])

  const modelOptions = createMemo(() =>
    sortModelOptions(
      models()
        .filter((model) => model.status !== "deprecated")
        .filter((model) => (props.providerID ? model.providerID === props.providerID : true))
        // A model's faster and slower speeds are chosen with the speed selector.
        .filter((model) => !local.model.isSpeed({ providerID: model.providerID, modelID: model.id }))
        .map((model) => {
          const providerName = providers().get(model.providerID)?.name ?? model.providerID
          const value = { providerID: model.providerID, modelID: model.id }
          const favorite = isFavorite(value)
          const category = connected() ? (freeGroup(model) ? "Free" : providerName) : undefined
          return {
            value,
            providerID: model.providerID,
            providerName,
            title: model.name,
            releaseDate: model.time.released,
            searchCategory: category,
            get description() {
              if (newDesigns()) return searching() ? providerName : undefined
              return favorite ? "(Favorite)" : undefined
            },
            get category() {
              // In search results the provider is shown inline and the footer can show the favorite marker.
              return newDesigns() && searching() ? undefined : category
            },
            footer: trailing(model, favorite),
            free: isFreeModel(model),
            onSelect() {
              props.onSelect(model.providerID, model.id)
            },
          }
        }),
      connected(),
    ),
  )

  const options = createMemo(() => {
    const needle = query().trim()
    if (needle) {
      return prioritizeFavorites(
        sortModelOptions(
          fuzzysort.go(needle, modelOptions(), { keys: ["title", "searchCategory"] }).map((item) => item.obj),
          false,
        ),
        favoritePriority,
      )
    }

    if (!connected()) return prioritizeFavorites(modelOptions(), favoritePriority)
    if (props.providerID) return modelOptions()

    const favorites = newDesigns() ? favoritesAtOpen : local.model.favorite()
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      return items.flatMap((item) => {
        const model = models().find((model) => model.providerID === item.providerID && model.id === item.modelID)
        if (!model) return []
        const provider = providers().get(model.providerID)
        return [
          {
            key: item,
            value: { providerID: model.providerID, modelID: model.id },
            title: model.name,
            releaseDate: model.time.released,
            description: provider?.name ?? model.providerID,
            category,
            footer: trailing(model, isFavorite(item)),
            onSelect: () => {
              props.onSelect(model.providerID, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const listed = modelOptions().filter(
      (option) =>
        !favorites.some(
          (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
        ) &&
        !recents.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID),
    )

    return [
      ...favoriteOptions,
      ...recentOptions,
      ...listed.filter((option) => option.category !== "Free"),
      ...listed.filter((option) => option.category === "Free"),
    ]
  })

  const provider = createMemo(() => (props.providerID ? providers().get(props.providerID) : undefined))

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      searchInTitle
      titlePlaceholder="Search models"
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: newDesigns()
            ? connected()
              ? "connect integration"
              : "view all integrations"
            : connected()
              ? "Connect an integration"
              : "View all integrations",
          selection: "none",
          onTrigger: props.onConnect,
        },
        {
          command: "model.dialog.favorite",
          title: newDesigns() ? (option) => (isFavorite(option?.value) ? "unfavorite" : "favorite") : "Favorite",
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.standard()}
    />
  )
}
