import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import * as fuzzysort from "fuzzysort"
import { useLocal } from "../context/local"
import { useData } from "../context/data"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { Locale } from "../util/locale"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant, listModelVariants } from "./dialog-variant"
import { DialogModelTwoPane } from "./dialog-model-twopane"
import { isSubscriptionProvider } from "../util/model-row"
import { DialogNote } from "./dialog-note"
import { useConnected } from "./use-connected"

export function DialogModel(props: {
  providerID?: string
  title?: string
  current?: { providerID: string; modelID: string }
  /** Shown in the title bar when `current` is unset (config pickers). */
  currentFallback?: string
  onSelect?: (providerID: string, modelID: string) => void | Promise<void>
}) {
  const local = useLocal()
  const sync = useSync()
  const data = useData()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [query, setQuery] = createSignal("")
  const dimensions = useTerminalDimensions()

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  // Custom onSelect means this dialog edits a config target, not the session
  // model — do not fall back to local.model.current() when unset.
  const selectionCurrent = createMemo(() => {
    if (props.onSelect) return props.current
    return props.current ?? local.model.current()
  })

  const selectionLabel = createMemo(() => {
    const current = selectionCurrent()
    if (current) {
      const provider = sync.data.provider.find((item) => item.id === current.providerID)
      const modelName = provider?.models[current.modelID]?.name ?? current.modelID
      const providerName = provider?.name ?? current.providerID
      return Locale.truncate(`${providerName} / ${modelName}`, 48)
    }
    return props.currentFallback
  })

  // openai is subscription when connected via ChatGPT Pro/Plus OAuth.
  const openaiSubscription = createMemo(() => {
    const integrations = data.location.integration.list() ?? []
    const openai = integrations.find((item) => item.id === "openai")
    if (!openai) return false
    return openai.connections.some(
      (conn) => conn.type === "credential" && /^chatgpt-(browser|headless)$/.test(conn.id),
    )
  })

  function isSubscriptionFor(providerID: string) {
    if (providerID === "openai") return openaiSubscription()
    return isSubscriptionProvider(providerID)
  }

  const showExtra = createMemo(() => connected() && !props.providerID)
  const useTwoPane = createMemo(() => !props.providerID && dimensions().width >= 70)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((provider) => provider.id === item.providerID)
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
            footer:
              isSubscriptionFor(provider.id) ? undefined : model.cost?.input === 0 ? "Free" : undefined,
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
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            releaseDate: info.release_date,
            contextSize: info.limit?.context ?? 0,
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === "opencode" && model.includes("-nano"),
            footer:
              isSubscriptionFor(provider.id) ? undefined : info.cost?.input === 0 ? "Free" : undefined,
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((option) => {
            if (!showSections) return true
            if (
              favorites.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            if (
              recents.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            return true
          }),
          (options) => sortModelOptions(options, props.providerID !== undefined),
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

    if (needle) {
      const currentProviderID = local.model.current()?.providerID
      const modelMatches = fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
      // Boost options from the current model's provider ahead of equally-scored options,
      // preserving fuzzysort's score order within each group.
      const boosted = currentProviderID
        ? sortBy(
            modelMatches.map((obj, i) => ({ obj, i })),
            [(item) => item.i, "asc"], // stable: lower index = better score
            (item) => (item.obj.value.providerID === currentProviderID ? 0 : 1),
          ).map((item) => item.obj)
        : modelMatches
      return [
        ...sortModelOptions(boosted, false),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((item) => item.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    if (props.title) return props.title
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    if (props.onSelect) {
      void props.onSelect(providerID, modelID)
      return
    }
    const model = { providerID, modelID }
    if (listModelVariants(sync.data.provider, model).length > 0) {
      dialog.setSize("medium")
      dialog.push(() => <DialogVariant model={model} onSelect={props.onSelect} />)
      return
    }
    local.model.set(model, { recent: true })
    dialog.clear()
  }

  return (
    <Show when={useTwoPane()} fallback={<DialogSelectInner />}>
      <DialogModelTwoPane
        title={title()}
        current={selectionCurrent()}
        currentLabel={selectionLabel()}
        onSelect={props.onSelect}
      />
    </Show>
  )

  function DialogSelectInner() {
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
          {
            command: "model.dialog.hide",
            title: "Hide",
            hidden: !connected(),
            onTrigger: (option) => {
              local.model.toggleHidden(option.value as { providerID: string; modelID: string })
            },
          },
          {
            command: "model.dialog.note",
            title: "Note",
            hidden: !connected(),
            onTrigger: (option) => {
              dialog.replace(() => <DialogNote model={option.value as { providerID: string; modelID: string }} />)
            },
          },
          {
            command: "model.dialog.variant",
            title: "Variants",
            hidden: !connected(),
            disabled: (option) => {
              if (!option) return true
              const value = option.value as { providerID: string; modelID: string }
              return listModelVariants(sync.data.provider, value).length === 0
            },
            onTrigger: (option) => {
              const value = option.value as { providerID: string; modelID: string }
              dialog.setSize("medium")
              dialog.push(() => <DialogVariant model={value} onSelect={props.onSelect} />)
            },
          },
        ]}
        onFilter={setQuery}
        flat={true}
        skipFilter={true}
        title={title()}
        titleView={
          <box flexDirection="row" justifyContent="space-between" flexGrow={1} gap={2}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {title()}
            </text>
            <Show when={selectionLabel()}>
              <text fg={theme.textMuted} wrapMode="none">
                ● {selectionLabel()}
              </text>
            </Show>
          </box>
        }
        current={selectionCurrent()}
      />
    )
  }
}

export function sortModelOptions<
  T extends { footer?: string; releaseDate: string | number; contextSize?: number; title: string },
>(options: T[], newestFirst: boolean) {
  if (newestFirst)
    return sortBy(
      options,
      [(option) => option.releaseDate, "desc"],
      [(option) => option.contextSize ?? 0, "desc"],
      (option) => option.title,
    )
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    [(option) => option.contextSize ?? 0, "desc"],
    (option) => option.title,
  )
}
