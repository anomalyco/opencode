import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createResource, createSignal, on, Show } from "solid-js"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useSessionTerminals } from "../context/session-terminals"
import { usePromptRef } from "../context/prompt"
import { Session } from "../routes/session"
import { Sidebar } from "../routes/session/sidebar"
import { SESSION_SIDEBAR_WIDTH } from "../ui/layout"
import { useToast } from "../ui/toast"
import { TerminalPane } from "./terminal-pane"

export function SessionFrame(props: { sessionID: string; verticalTabsWidth: number }) {
  const sessions = useSessionTerminals()
  const prompt = usePromptRef()
  const config = useConfig()
  const data = useData()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [sessionWidth, setSessionWidth] = createSignal<number>()
  const [terminalFocused, setTerminalFocused] = createSignal(false)
  const [restoreTerminalFocus, setRestoreTerminalFocus] = createSignal(false)
  let focusTerminal: (() => void) | undefined
  createResource(
    () => (config.data.terminal?.enabled ? props.sessionID : undefined),
    (sessionID) => sessions.refresh(sessionID).catch(() => undefined),
  )
  const session = () => sessions.get(props.sessionID)
  const terminals = () => session()?.terminals ?? []
  const selectedTerminal = () => {
    if (!config.data.terminal?.enabled) return
    const value = session()
    if (value?.hidden) return
    return value?.terminals.find((terminal) => terminal.id === value.selectedTerminalID) ?? value?.terminals.at(-1)
  }
  createEffect(
    on(
      () => selectedTerminal()?.id,
      (id) => {
        if (id) setSidebarOpen(false)
      },
      { defer: true },
    ),
  )
  const wide = createMemo(() => dimensions().width - props.verticalTabsWidth > 120)
  const sidebarVisible = createMemo(() => {
    if (data.session.get(props.sessionID)?.parentID) return false
    if (sidebarOpen()) return true
    return (config.data.session?.sidebar ?? "auto") === "auto" && wide()
  })
  const rightPane = createMemo(() => {
    if (sidebarOpen() && sidebarVisible()) return "sidebar"
    if (selectedTerminal()) return "terminal"
    if (sidebarVisible() && !session()?.hidden) return "sidebar"
  })
  const toggleSidebar = () => {
    batch(() => {
      const visible = rightPane() === "sidebar"
      void config
        .update((draft) => {
          draft.session = { ...draft.session, sidebar: visible ? "hide" : "auto" }
        })
        .catch(toast.error)
      setSidebarOpen(!visible)
      if (!visible && selectedTerminal()) void sessions.hideTerminal(props.sessionID).catch(toast.error)
    })
  }
  createEffect(() => {
    if (!restoreTerminalFocus() || terminals().length > 0) return
    setRestoreTerminalFocus(false)
    prompt.current?.focus()
  })
  Keymap.createLayer(() => ({
    enabled: () => config.data.terminal?.enabled === true,
    commands: [
      {
        id: "pane.focus.left",
        title: "Focus session pane",
        run: () => {
          prompt.current?.focus()
        },
      },
      {
        id: "pane.focus.right",
        title: "Focus terminal pane",
        run: () => {
          focusTerminal?.()
        },
      },
    ],
  }))

  return (
    <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="row" position="relative">
      <box
        flexGrow={1}
        flexBasis={0}
        minWidth={0}
        minHeight={0}
        position="relative"
        onSizeChange={function () {
          setSessionWidth(this.width)
        }}
      >
        <Session
          verticalTabsWidth={props.verticalTabsWidth}
          promptMuted={terminalFocused()}
          sidebarVisible={rightPane() === "sidebar"}
          onToggleSidebar={toggleSidebar}
          visibleTerminalID={rightPane() === "terminal" ? selectedTerminal()?.id : undefined}
          width={sessionWidth()}
        />
        <Show when={terminalFocused()}>
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            zIndex={1}
            onMouseDown={() => prompt.current?.focus()}
          />
        </Show>
      </box>
      <Show when={rightPane() === "terminal" || (rightPane() === "sidebar" && wide())}>
        <box
          flexShrink={0}
          width={
            rightPane() === "terminal"
              ? Math.max(1, Math.floor((dimensions().width - props.verticalTabsWidth) / 2))
              : SESSION_SIDEBAR_WIDTH
          }
          minWidth={0}
          minHeight={0}
        >
          <Show
            when={rightPane() === "sidebar"}
            fallback={
              <Show keyed when={selectedTerminal()}>
                {(terminal) => (
                  <TerminalPane
                    ptyID={terminal.id}
                    autoFocus={restoreTerminalFocus() || sessions.shouldFocus(terminal.id)}
                    onAutoFocus={() => {
                      sessions.clearFocus(terminal.id)
                      setRestoreTerminalFocus(false)
                    }}
                    onFocusChange={setTerminalFocused}
                    onFocusRequest={(value) => (focusTerminal = value)}
                    onDisconnect={() => setRestoreTerminalFocus(true)}
                  />
                )}
              </Show>
            }
          >
            <Sidebar sessionID={props.sessionID} />
          </Show>
        </box>
      </Show>
      <Show when={rightPane() === "sidebar" && !wide()}>
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          alignItems="flex-end"
          backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
        >
          <Sidebar sessionID={props.sessionID} />
        </box>
      </Show>
    </box>
  )
}
