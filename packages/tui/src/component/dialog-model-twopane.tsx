import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { pipe, entries, filter, flatMap, map, sortBy } from "remeda"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"
import { useBindings } from "../keymap"
import { useConnected } from "./use-connected"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import { DialogNote } from "./dialog-note"
import { type ModelShape } from "../util/model"
import { modelRow, type ModelRowTheme } from "../util/model-row"
import type { Provider } from "@kancode/sdk/v2"

type ModelValue = { providerID: string; modelID: string }

type LeftEntry =
  | { kind: "favorites"; count: number }
  | { kind: "recents"; count: number }
  | { kind: "hidden"; count: number }
  | { kind: "provider"; providerID: string; count: number }
  | { kind: "connect" }

export interface DialogModelTwoPaneProps {
  title?: string
  current?: ModelValue
  onSelect?: (providerID: string, modelID: string) => void | Promise<void>
}

const PROVIDER_PIN_FIRST = (provider: Provider) => provider.id !== "opencode"

export function DialogModelTwoPane(props: DialogModelTwoPaneProps) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const connected = useConnected()
  const providerOptions = createDialogProviderOptions()

  const rowTheme: ModelRowTheme = {
    text: theme.text,
    textMuted: theme.textMuted,
    success: theme.success,
    warning: theme.warning,
    info: theme.info,
    accent: theme.accent,
  }

  const [focusedPane, setFocusedPane] = createSignal<"left" | "right">("left")
  const [leftSelected, setLeftSelected] = createSignal(0)
  // Which left entry the right pane is showing. Null until a provider is chosen.
  type RightMode =
    | { kind: "provider"; providerID: string }
    | { kind: "hidden" }
    | { kind: "favorites" }
    | { kind: "recents" }
  const initialMode: RightMode | null = (() => {
    const current = props.current ?? local.model.current()
    if (current) return { kind: "provider", providerID: current.providerID }
    if (sync.data.provider[0]) return { kind: "provider", providerID: sync.data.provider[0].id }
    return null
  })()
  const [rightMode, setRightMode] = createSignal<RightMode | null>(initialMode)
  let rightRef: DialogSelectRef<ModelValue> | undefined

  // ----- Left pane entries -----
  const leftEntries = createMemo<LeftEntry[]>(() => {
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()
    const hidden = local.model.hidden()
    const entries: LeftEntry[] = []
    if (favorites.length) entries.push({ kind: "favorites", count: favorites.length })
    if (recents.length) entries.push({ kind: "recents", count: recents.length })
    if (hidden.length) entries.push({ kind: "hidden", count: hidden.length })
    for (const provider of pipe(sync.data.provider, sortBy(PROVIDER_PIN_FIRST, (p) => p.name))) {
      const count = countVisibleModels(provider)
      if (count > 0) entries.push({ kind: "provider", providerID: provider.id, count })
    }
    if (!connected()) entries.push({ kind: "connect" })
    return entries
  })

  function countVisibleModels(provider: Provider) {
    return pipe(
      provider.models,
      entries(),
      filter(([_, info]) => info.status !== "deprecated"),
      filter(([modelID]) => !(provider.id === "opencode" && modelID.includes("-nano"))),
      filter(([modelID]) => !local.model.isHidden({ providerID: provider.id, modelID })),
      flatMap(() => [1]),
    ).length
  }

  function leftEntryTitle(entry: LeftEntry): string {
    switch (entry.kind) {
      case "favorites":
        return "★ Favorites"
      case "recents":
        return "⟳ Recent"
      case "hidden":
        return "⌧ Hidden"
      case "provider":
        return providerName(entry.providerID)
      case "connect":
        return "+ Connect provider"
    }
  }

  function providerName(providerID: string) {
    return sync.data.provider.find((p) => p.id === providerID)?.name ?? providerID
  }

  // ----- Right pane options -----
  const rightOptions = createMemo<DialogSelectOption<ModelValue>[]>(() => {
    const mode = rightMode()
    if (!mode) return []
    if (mode.kind === "provider") {
      const provider = sync.data.provider.find((p) => p.id === mode.providerID)
      if (!provider) return []
      const visiblePeers = visibleModelsForProvider(provider)
      return pipe(
        provider.models,
        entries(),
        filter(([_, info]) => info.status !== "deprecated"),
        filter(([modelID]) => !(provider.id === "opencode" && modelID.includes("-nano"))),
        filter(([modelID]) => !local.model.isHidden({ providerID: provider.id, modelID })),
        map(([modelID, info]) => {
          const isFavorite = local.model.favorite().some(
            (f) => f.providerID === provider.id && f.modelID === modelID,
          )
          const note = local.model.note({ providerID: provider.id, modelID })
          const current = props.current ?? local.model.current()
          return modelRow(info, modelID, provider, visiblePeers, rowTheme, {
            favorite: isFavorite,
            note,
            current: current?.providerID === provider.id && current?.modelID === modelID,
            onSelect: () => commitSelect(provider.id, modelID),
          })
        },
        ),
        (rows) => rows.sort((a, b) => 0), // preserve catalog order; sort helper expects flat shape
      )
    }
    if (mode.kind === "hidden") {
      const hidden = local.model.hidden()
      return hidden.flatMap((item) => {
        const provider = sync.data.provider.find((p) => p.id === item.providerID)
        if (!provider) return []
        const info = provider.models[item.modelID]
        if (!info) return []
        const visiblePeers: ModelShape[] = [info]
        const note = local.model.note(item)
        return [
          modelRow(info, item.modelID, provider, visiblePeers, rowTheme, {
            note,
            onSelect: () => commitSelect(item.providerID, item.modelID),
          }),
        ]
      })
    }
    if (mode.kind === "favorites" || mode.kind === "recents") {
      const items = mode.kind === "favorites" ? local.model.favorite() : local.model.recent()
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((p) => p.id === item.providerID)
        if (!provider) return []
        const info = provider.models[item.modelID]
        if (!info) return []
        const note = local.model.note(item)
        const current = props.current ?? local.model.current()
        return [
          modelRow(info, item.modelID, provider, [info], rowTheme, {
            favorite: mode.kind === "favorites",
            note,
            current: current?.providerID === item.providerID && current?.modelID === item.modelID,
            onSelect: () => commitSelect(item.providerID, item.modelID),
          }),
        ]
      })
    }
    return []
  })

  function visibleModelsForProvider(provider: Provider): ModelShape[] {
    return pipe(
      provider.models,
      entries(),
      filter(([_, info]) => info.status !== "deprecated"),
      filter(([modelID]) => !(provider.id === "opencode" && modelID.includes("-nano"))),
      filter(([modelID]) => !local.model.isHidden({ providerID: provider.id, modelID })),
      map(([_, info]) => info),
    )
  }

  function commitSelect(providerID: string, modelID: string) {
    if (props.onSelect) {
      void props.onSelect(providerID, modelID)
      return
    }
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

  // ----- Left pane navigation -----
  function moveLeft(direction: 1 | -1) {
    const entries = leftEntries()
    if (!entries.length) return
    let next = leftSelected() + direction
    if (next < 0) next = entries.length - 1
    if (next >= entries.length) next = 0
    setLeftSelected(next)
  }

  function activateLeft() {
    const entry = leftEntries()[leftSelected()]
    if (!entry) return
    if (entry.kind === "favorites") {
      // Jump straight to the first favorite (one-keystroke).
      const first = local.model.favorite()[0]
      if (first) commitSelect(first.providerID, first.modelID)
      return
    }
    if (entry.kind === "recents") {
      const first = local.model.recent()[0]
      if (first) commitSelect(first.providerID, first.modelID)
      return
    }
    if (entry.kind === "hidden") {
      setRightMode({ kind: "hidden" })
      setFocusedPane("right")
      return
    }
    if (entry.kind === "provider") {
      setRightMode({ kind: "provider", providerID: entry.providerID })
      setFocusedPane("right")
      return
    }
    if (entry.kind === "connect") {
      dialog.replace(() => <DialogProvider />)
      return
    }
  }

  useBindings(() => ({
    enabled: () => focusedPane() === "left",
    bindings: [
      { key: "up", desc: "Previous provider", group: "Model dialog", cmd: () => moveLeft(-1) },
      { key: "down", desc: "Next provider", group: "Model dialog", cmd: () => moveLeft(1) },
      { key: "return", desc: "Select provider", group: "Model dialog", cmd: activateLeft },
    ],
  }))

  useBindings(() => ({
    enabled: () => focusedPane() === "left",
    bindings: [
      {
        key: "tab",
        desc: "Focus models pane",
        group: "Model dialog",
        cmd: () => setFocusedPane("right"),
      },
    ],
  }))

  // Right pane forwards Tab back to the left when no footer action is focused.
  // We register a parent binding that fires only when the right pane is focused.
  useBindings(() => ({
    enabled: () => focusedPane() === "right",
    bindings: [
      {
        key: "shift+tab",
        desc: "Focus providers pane",
        group: "Model dialog",
        cmd: () => setFocusedPane("left"),
      },
    ],
  }))

  const title = () => props.title ?? "Select model"
  const currentModel = () => props.current ?? local.model.current()

  function LeftPane(props: { entry: LeftEntry; index: number }) {
    const selected = createMemo(() => leftSelected() === props.index && focusedPane() === "left")
    const count = () => (props.entry.kind === "connect" ? undefined : (props.entry as { count: number }).count)
    return (
      <box
        flexDirection="row"
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={selected() ? theme.primary : undefined}
        onMouseUp={() => {
          setLeftSelected(props.index)
          setFocusedPane("left")
          activateLeft()
        }}
      >
        <text
          fg={selected() ? theme.selectedListItemText : theme.text}
          attributes={selected() ? TextAttributes.BOLD : undefined}
        >
          {leftEntryTitle(props.entry)}
        </text>
        <Show when={count() !== undefined}>
          <text fg={selected() ? theme.selectedListItemText : theme.textMuted}> {count()}</text>
        </Show>
      </box>
    )
  }

  function RightPane() {
    const rightTitle = createMemo(() => {
      const mode = rightMode()
      if (!mode) return props.title ?? "Select model"
      if (mode.kind === "provider") return providerName(mode.providerID)
      if (mode.kind === "hidden") return "Hidden models"
      if (mode.kind === "favorites") return "Favorites"
      if (mode.kind === "recents") return "Recent"
      return props.title ?? "Select model"
    })

    const isHiddenMode = createMemo(() => rightMode()?.kind === "hidden")

    return (
      <DialogSelect<ModelValue>
        title={rightTitle()}
        options={rightOptions()}
        current={currentModel()}
        flat={true}
        skipFilter={true}
        locked={focusedPane() !== "right"}
        ref={(r) => {
          rightRef = r
        }}
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
            hidden: !connected() || isHiddenMode(),
            onTrigger: (option) => {
              if (!option) return
              local.model.toggleFavorite(option.value)
            },
          },
          {
            command: "model.dialog.hide",
            title: isHiddenMode() ? "Unhide" : "Hide",
            hidden: !connected(),
            onTrigger: (option) => {
              if (!option) return
              local.model.toggleHidden(option.value)
            },
          },
          {
            command: "model.dialog.note",
            title: "Note",
            hidden: !connected(),
            onTrigger: (option) => {
              if (!option) return
              dialog.replace(() => <DialogNote model={option.value} />)
            },
          },
          {
            command: "model.dialog.variant",
            title: "Variants",
            hidden: !connected() || isHiddenMode(),
            disabled: (option) => {
              if (!option) return true
              // Variants action operates on the current model (DialogVariant reads
              // the current model's variants), so only enable when the highlighted
              // model IS the current model and has variants.
              const current = props.current ?? local.model.current()
              if (!current) return true
              if (option.value.providerID !== current.providerID || option.value.modelID !== current.modelID)
                return true
              const provider = sync.data.provider.find((p) => p.id === option.value.providerID)
              const info = provider?.models[option.value.modelID]
              if (!info?.variants) return true
              return Object.keys(info.variants).length === 0
            },
            onTrigger: () => {
              dialog.replace(() => <DialogVariant />)
            },
          },
        ]}
      />
    )
  }

  return (
    <box paddingLeft={4} paddingRight={4} paddingBottom={1} flexDirection="row" gap={2} flexGrow={1}>
      <box flexDirection="column" flexShrink={0}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          {title()}
        </text>
        <text fg={theme.textMuted}>Providers</text>
        <For each={leftEntries()}>
          {(entry, index) => <LeftPane entry={entry} index={index()} />}
        </For>
      </box>
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <RightPane />
      </box>
    </box>
  )
}