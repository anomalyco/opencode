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
import {
  rankModelSearchMatches,
  resolveModelSelect,
  resolveSearchBoostProviderID,
  resolveSelectionCurrent,
} from "./dialog-model-flow"
import { isSubscriptionProvider } from "../util/model-row"
import { DialogNote } from "./dialog-note"
import { useConnected } from "./use-connected"

export function DialogModel(props: {
  /**
   * After connect: open the model dialog on this provider.
   * Wide terminals use the two-pane picker focused on it; narrow terminals
   * filter the single-pane list to that provider's models.
   */
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
  const selectionCurrent = createMemo(() =>
    resolveSelectionCurrent({
      configPicker: !!props.onSelect,
      current: props.current,
      sessionCurrent: local.model.current(),
    }),
  )

  const selectionLabel = createMemo(() => {
    const current = selectionCurrent()
    if (current) {
      const provider = sync.data.provider.find((item) => item.id === current.providerID)
      const modelName = provider?.models[current.modelID]?.name ?? current.modelID
      const providerName = provider?.name ?? current.providerID
      return Locale.truncate(`current: ${modelName} · ${providerName}`, 56)
    }
    if (!props.currentFallback) return undefined
    return `current: ${props.currentFallback}`
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

  const useTwoPane = createMemo(() => dimensions().width >= 70)
  // Narrow post-connect: filter to the new provider. Wide: full dialog (two-pane).
  const filterProviderID = createMemo(() => (useTwoPane() ? undefined : props.providerID))
  const showExtra = createMemo(() => connected() && !filterProviderID())

  const configPicker = () => !!props.onSelect

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite().filter((item) => !local.model.isHidden(item)) : []
    const recents = local.model.recent().filter((item) => !local.model.isHidden(item))
    const hidden = connected()
      ? local.model.hidden().filter((item) => {
          const provider = sync.data.provider.find((p) => p.id === item.providerID)
          return !!provider?.models[item.modelID]
        })
      : []

    function toOptions(items: typeof favorites, category: string, opts?: { muted?: boolean }) {
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
            muted: opts?.muted === true,
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
    const hiddenOptions = toOptions(hidden, "Hidden", { muted: true })

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
          filter(([_, info]) => (filterProviderID() ? info.providerID === filterProviderID() : true)),
          map(([model, info]) => {
            const value = { providerID: provider.id, modelID: model }
            const isHidden = local.model.isHidden(value)
            return {
              value,
              title: info.name ?? model,
              releaseDate: info.release_date,
              contextSize: info.limit?.context ?? 0,
              muted: isHidden,
              description: isHidden
                ? "(Hidden)"
                : favorites.some((item) => item.providerID === provider.id && item.modelID === model)
                  ? "(Favorite)"
                  : undefined,
              category: connected() ? provider.name : undefined,
              disabled: provider.id === "opencode" && model.includes("-nano"),
              footer:
                isSubscriptionFor(provider.id) ? undefined : info.cost?.input === 0 ? "Free" : undefined,
              onSelect() {
                onSelect(provider.id, model)
              },
            }
          }),
          filter((option) => {
            // Hidden models belong under the Hidden section when sections are shown.
            if (showSections && option.muted) return false
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
          (options) => sortModelOptions(options, filterProviderID() !== undefined),
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
      // Keep fuzzysort relevance order; boost picker/session current provider.
      // Do not re-sort with sortModelOptions — that wipes score ranking.
      const boostProviderID = resolveSearchBoostProviderID({
        configPicker: configPicker(),
        current: props.current,
        sessionCurrent: local.model.current(),
      })
      return [
        ...rankModelSearchMatches(needle, providerOptions, boostProviderID),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...hiddenOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    filterProviderID() ? sync.data.provider.find((item) => item.id === filterProviderID()) : null,
  )

  const title = createMemo(() => {
    if (props.title) return props.title
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function openVariantPicker(model: { providerID: string; modelID: string }) {
    dialog.setSize("medium")
    // Narrow stays medium; onClose keeps size stable if a future nested dialog changes it.
    dialog.push(
      () => <DialogVariant model={model} onSelect={props.onSelect} />,
      () => dialog.setSize("medium"),
    )
  }

  function onSelect(providerID: string, modelID: string) {
    const action = resolveModelSelect({
      providerID,
      modelID,
      configPicker: configPicker(),
      hasVariants: listModelVariants(sync.data.provider, { providerID, modelID }).length > 0,
    })
    if (action.type === "callback") {
      void props.onSelect?.(action.providerID, action.modelID)
      return
    }
    if (action.type === "open-variants") {
      openVariantPicker(action.model)
      return
    }
    local.model.set(action.model, { recent: true })
    dialog.clear()
  }

  return (
    <Show when={useTwoPane()} fallback={<DialogSelectInner />}>
      <DialogModelTwoPane
        title={props.title ?? "Select model"}
        current={selectionCurrent()}
        currentLabel={selectionLabel()}
        onSelect={props.onSelect}
        initialProviderID={props.providerID}
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
            title: (option) => {
              if (!option) return "Hide"
              const value = option.value as { providerID: string; modelID: string }
              // Match two-pane: Hidden-section / muted rows show Unhide.
              return option.muted === true || local.model.isHidden(value) ? "Unhide" : "Hide"
            },
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
              dialog.push(() => <DialogNote model={option.value as { providerID: string; modelID: string }} />)
            },
          },
          {
            command: "model.dialog.variant",
            title: "Variants",
            // Config pickers ignore variant selection — hide the affordance.
            hidden: !connected() || configPicker(),
            disabled: (option) => {
              if (!option) return true
              const value = option.value as { providerID: string; modelID: string }
              return listModelVariants(sync.data.provider, value).length === 0
            },
            onTrigger: (option) => {
              openVariantPicker(option.value as { providerID: string; modelID: string })
            },
          },
        ]}
        onFilter={setQuery}
        flat={true}
        skipFilter={true}
        title={title()}
        titleView={
          <box flexDirection="row" flexGrow={1} gap={2} overflow="hidden">
            <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
              {title()}
            </text>
            <Show when={selectionLabel()}>
              <text fg={theme.textMuted} wrapMode="none">
                {selectionLabel()}
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
