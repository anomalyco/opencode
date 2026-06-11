import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { map, pipe, filter, sortBy, take } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useData } from "../context/data"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const data = useData()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = data.location.provider.list()?.find((provider) => provider.id === item.providerID)
        if (!provider) return []
        const model = data.location.model
          .list()
          ?.find((model) => model.providerID === item.providerID && model.id === item.modelID)
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name,
            description: provider.name,
            category,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            footer: model.cost[0]?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect: () => {
              onSelect(provider.id, model.id)
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

    const providerOptions = pipe(
      data.location.model.list() ?? [],
      filter((model) => model.status !== "deprecated"),
      filter((model) => (props.providerID ? model.providerID === props.providerID : true)),
      sortBy(
        (model) => model.providerID !== "opencode",
        (model) => data.location.provider.list()?.find((provider) => provider.id === model.providerID)?.name ?? "",
        [(model) => model.time.released, "desc"],
      ),
      map((model) => ({
        value: { providerID: model.providerID, modelID: model.id },
        title: model.name,
        releaseDate: model.time.released,
        description: favorites.some((item) => item.providerID === model.providerID && item.modelID === model.id)
          ? "(Favorite)"
          : undefined,
        category: connected()
          ? data.location.provider.list()?.find((provider) => provider.id === model.providerID)?.name
          : undefined,
        disabled: !model.enabled || (model.providerID === "opencode" && model.id.includes("-nano")),
        footer: model.cost[0]?.input === 0 && model.providerID === "opencode" ? "Free" : undefined,
        onSelect() {
          onSelect(model.providerID, model.id)
        },
      })),
      filter((option) => {
        if (!showSections) return true
        if (
          favorites.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID)
        )
          return false
        if (
          recents.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID)
        )
          return false
        return true
      }),
      (options) => sortModelOptions(options, props.providerID !== undefined),
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

    if (needle) {
      return [
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? data.location.provider.list()?.find((item) => item.id === props.providerID) : null,
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
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    (option) => option.title,
  )
}
