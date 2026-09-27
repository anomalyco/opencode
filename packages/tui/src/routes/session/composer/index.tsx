import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../../context/theme"
import { SplitBorder } from "../../../ui/border"
import { Keymap } from "../../../context/keymap"
import { SubagentsTab } from "./subagents-tab"
import { ShellTab } from "./shell-tab"
import { TerminalsTab } from "./terminals-tab"
import { useConfig } from "../../../config"
import { ComposerContext, type ComposerTab } from "./context"

export { useComposerTab, type ComposerHint } from "./context"

export type ComposerProps = {
  sessionID: string
  open: boolean
  defaultTab?: string
  onClose?: () => void
  visibleTerminalID?: string
}

export function Composer(props: ComposerProps) {
  const theme = useTheme()
  const config = useConfig().data

  const [store, setStore] = createStore({
    tabs: {} as Record<string, ComposerTab>,
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
    register(tab: ComposerTab) {
      setStore("tabs", tab.id, tab)
      if (!store.active) setStore("active", tab.id)
      return () => setStore("tabs", tab.id, undefined!)
    },
    active(id: string) {
      return props.open && store.active === id
    },
    close,
  }

  const keymap = Keymap.use()
  createEffect(() => {
    if (!props.open) return
    const popMode = keymap.mode.push("composer")
    onCleanup(popMode)
  })

  const switchTab = (dir: number) => {
    const tabs = tabList()
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === store.active)
    setStore("active", tabs[(idx + dir + tabs.length) % tabs.length].id)
  }

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => props.open,
    priority: 1,
    commands: [
      { bind: "left", title: "Previous tab", group: "Composer", run: () => switchTab(-1) },
      { bind: "right", title: "Next tab", group: "Composer", run: () => switchTab(1) },
      { bind: "escape", title: "Close composer", group: "Composer", run: close },
      { bind: "ctrl+c", title: "Close composer", group: "Composer", run: close },
    ],
  }))

  return (
    <ComposerContext.Provider value={ctx}>
      <box flexShrink={0} visible={props.open}>
        <box
          {...SplitBorder}
          border={["left"]}
          borderColor={theme.border.base}
          backgroundColor={theme.background.raised.base}
          paddingLeft={1}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <box gap={1}>
            <box flexDirection="row" justifyContent="space-between" paddingLeft={1}>
              <Show
                when={tabList().length > 1}
                fallback={
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                    {tabList()[0]?.label ?? ""}
                  </text>
                }
              >
                <box flexDirection="row" gap={2}>
                  <For each={tabList()}>
                    {(t) => {
                      const isActive = createMemo(() => store.active === t.id)
                      return (
                        <text
                          fg={isActive() ? theme.text.base : theme.text.muted}
                          attributes={isActive() ? TextAttributes.BOLD : undefined}
                        >
                          {t.label}
                        </text>
                      )
                    }}
                  </For>
                </box>
              </Show>
              <text fg={theme.text.muted} onMouseUp={close}>
                esc
              </text>
            </box>
            <SubagentsTab sessionID={props.sessionID} />
            <ShellTab sessionID={props.sessionID} />
            <Show when={config.session.terminal}>
              <TerminalsTab sessionID={props.sessionID} visibleTerminalID={props.visibleTerminalID} />
            </Show>
            <box flexDirection="row" gap={2} paddingLeft={1} flexShrink={0}>
              <For each={footerHints()}>
                {(hint) => (
                  <text>
                    <span style={{ fg: theme.text.base }}>
                      <b>{hint.label}</b>{" "}
                    </span>
                    <span style={{ fg: theme.text.muted }}>{hint.shortcut}</span>
                  </text>
                )}
              </For>
              <Show when={tabList().length > 1}>
                <text>
                  <span style={{ fg: theme.text.base }}>
                    <b>tabs</b>{" "}
                  </span>
                  <span style={{ fg: theme.text.muted }}>←/→</span>
                </text>
              </Show>
            </box>
          </box>
        </box>
      </box>
    </ComposerContext.Provider>
  )
}
