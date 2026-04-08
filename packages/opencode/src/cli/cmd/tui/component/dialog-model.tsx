import { createMemo, createSignal, onMount } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useRoute } from "../context/route"
import * as fuzzysort from "fuzzysort"
import type { AssistantMessage, Model as ProviderModel } from "@opencode-ai/sdk/v2"

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
  const { theme } = useTheme()
  const route = useRoute()
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
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
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
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === "opencode" && model.includes("-nano"),
            footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((x) => {
            if (!showSections) return true
            if (favorites.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            if (recents.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
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

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const info = createMemo(() =>
    sync.data.provider.flatMap((provider) =>
      Object.entries(provider.models).map(([modelID, model]) => ({
        key: `${provider.id}/${modelID}`,
        provider,
        model,
      })),
    ),
  )

  const sessionTokens = createMemo(() => {
    if (route.data.type !== "session") return undefined
    const msg = sync.data.message[route.data.sessionID] ?? []
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return undefined
    return (
      last.tokens.total ??
      last.tokens.input +
        last.tokens.output +
        last.tokens.reasoning +
        last.tokens.cache.read +
        last.tokens.cache.write
    )
  })

  function detail(value?: { providerID: string; modelID: string }) {
    if (!value) return undefined
    return info().find((item) => item.key === `${value.providerID}/${value.modelID}`)
  }

  function input(model: ProviderModel) {
    const v = model.capabilities?.input
    if (!v) return "text"
    const list = (["text", "image", "audio", "video", "pdf"] as const).filter((k) => v[k])
    if (list.length === 0) return "text"
    return list.join(", ")
  }

  function status(model: ProviderModel) {
    const tokens = sessionTokens()
    if (tokens === undefined) {
      return {
        color: theme.textMuted,
        text: "Status: Unknown (open a session to evaluate)",
      }
    }
    const reserved = sync.data.config.compaction?.reserved ?? Math.min(20_000, Math.min(model.limit.output, 32_000) || 32_000)
    const usable = model.limit.input ? model.limit.input - reserved : model.limit.context - (Math.min(model.limit.output, 32_000) || 32_000)
    const threshold = Math.max(0, usable)
    const auto = sync.data.config.compaction?.auto !== false
    if (tokens > model.limit.context) {
      return {
        color: theme.error,
        text: "⊙ Context insufficient",
      }
    }
    if (auto && tokens >= threshold) {
      return {
        color: theme.warning,
        text: "⊙ Context warning (will compact next turn)",
      }
    }
    return {
      color: theme.success,
      text: "⊙ Context sufficient",
    }
  }

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
      details={{
        minWidth: 110,
        listWidth: 52,
        render: (option) => {
          const val = detail(option?.value as { providerID: string; modelID: string } | undefined)
          if (!val) {
            return (
              <box>
                <text fg={theme.textMuted}>Move with ↑/↓ to preview model details</text>
              </box>
            )
          }
          const s = status(val.model)
          return (
            <box flexDirection="column" gap={1}>
              <text fg={theme.text}>
                <b>{val.model.name ?? val.model.id}</b>
              </text>
              <text fg={theme.textMuted}>{val.provider.name}</text>
              <text fg={theme.textMuted}>Supports: {input(val.model)}</text>
              <text fg={theme.textMuted}>Reasoning: {val.model.capabilities?.reasoning ? "Yes" : "No"}</text>
              <text fg={theme.textMuted}>Context: {val.model.limit.context.toLocaleString()}</text>
              <text fg={s.color}>{s.text}</text>
            </box>
          )
        },
      }}
    />
  )
}
