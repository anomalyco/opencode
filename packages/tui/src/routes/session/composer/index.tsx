import { createEffect, createMemo, For, onCleanup, Show, useContext, createContext } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../../context/theme"
import { SplitBorder } from "../../../ui/border"
import { useBindings, useOpencodeModeStack, useCommandShortcut } from "../../../keymap"
import { SubagentsTab } from "./subagents-tab"
import { ShellTab } from "./shell-tab"

export interface ComposerHint {
  label: string
  shortcut: string
}

interface Tab {
  id: string
  label: string
  hints?: () => ComposerHint[]
  onClose?: () => void
}

const ComposerContext = createContext<{
  register: (tab: Tab) => () => void
  active: (id: string) => boolean
}>()

export function useComposerTab() {
  const ctx = useContext(ComposerContext)
  if (!ctx) throw new Error("useComposerTab must be used within a Composer")
  return ctx
}

export type ComposerProps = {
  sessionID: string
  open: boolean
  defaultTab?: string
  onClose?: () => void
}

export function Composer(props: ComposerProps) {
  const { theme } = useTheme()

  const [store, setStore] = createStore({
    tabs: {} as Record<string, Tab>,
    active: "",
  })

  const tabList = createMemo(() => Object.values(store.tabs))
  const activeTab = createMemo(() => tabList().find((t) => t.id === store.active))
  const footerHints = createMemo(() => activeTab()?.hints?.() ?? [])

  // Set active tab when opened
  createEffect(() => {
    if (!props.open) return
    const tabs = tabList()
    if (tabs.length === 0) return
    const match = props.defaultTab && tabs.find((t) => t.id === props.defaultTab)
    setStore("active", match ? match.id : tabs[0].id)
  })

  function close() {
    const tab = activeTab()
    tab?.onClose?.()
    props.onClose?.()
  }

  const ctx = {
    register(tab: Tab) {
      setStore("tabs", tab.id, tab)
      if (!store.active) setStore("active", tab.id)
      return () => setStore("tabs", tab.id, undefined!)
    },
    active(id: string) {
      return props.open && store.active === id
    },
  }

  const modeStack = useOpencodeModeStack()
  createEffect(() => {
    if (!props.open) return
    const popMode = modeStack.push("composer")
    onCleanup(popMode)
  })

  const switchTab = (dir: number) => {
    const tabs = tabList()
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === store.active)
    setStore("active", tabs[(idx + dir + tabs.length) % tabs.length].id)
  }

  useBindings(() => ({
    mode: "composer",
    enabled: () => props.open,
    bindings: [
      { key: "left", desc: "Previous tab", group: "Composer", cmd: () => switchTab(-1) },
      { key: "right", desc: "Next tab", group: "Composer", cmd: () => switchTab(1) },
      { key: "escape", desc: "Close composer", group: "Composer", cmd: close },
      {
        key: "<leader>down",
        desc: "Toggle composer",
        group: "Composer",
        cmd: close,
      },
    ],
  }))

  const closeHint = useCommandShortcut("session.child_first")

  return (
    <ComposerContext.Provider value={ctx}>
      <box flexShrink={0} visible={props.open}>
        <box
          {...SplitBorder}
          border={["left"]}
          borderColor={theme.border}
          backgroundColor={theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <box gap={1}>
            <Show
              when={tabList().length > 1}
              fallback={
                <box flexDirection="row" paddingLeft={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {tabList()[0]?.label ?? ""}
                  </text>
                </box>
              }
            >
              <box flexDirection="row" gap={2} paddingLeft={1}>
                <For each={tabList()}>
                  {(t) => {
                    const isActive = createMemo(() => store.active === t.id)
                    return (
                      <text
                        fg={isActive() ? theme.text : theme.textMuted}
                        attributes={isActive() ? TextAttributes.BOLD : undefined}
                      >
                        {t.label}
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <SubagentsTab sessionID={props.sessionID} />
            <ShellTab sessionID={props.sessionID} />
            <box flexDirection="row" gap={2} paddingLeft={1} flexShrink={0}>
              <For each={footerHints()}>
                {(hint) => (
                  <text>
                    <span style={{ fg: theme.text }}>
                      <b>{hint.label}</b>{" "}
                    </span>
                    <span style={{ fg: theme.textMuted }}>{hint.shortcut}</span>
                  </text>
                )}
              </For>
              <Show when={tabList().length > 1}>
                <text>
                  <span style={{ fg: theme.text }}>
                    <b>tabs</b>{" "}
                  </span>
                  <span style={{ fg: theme.textMuted }}>←/→</span>
                </text>
              </Show>
              <text>
                <span style={{ fg: theme.text }}>
                  <b>close</b>{" "}
                </span>
                <span style={{ fg: theme.textMuted }}>{closeHint()}</span>
              </text>
            </box>
          </box>
        </box>
      </box>
    </ComposerContext.Provider>
  )
}
