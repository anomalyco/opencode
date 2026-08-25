import type { PersistentPtyInfo } from "@opencode-ai/client"
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
import { createAnimatable, tween } from "../ui/animation"
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
  const [sidebarSelected, setSidebarSelected] = createSignal(false)
  const [sessionWidth, setSessionWidth] = createSignal<number>()
  const [terminalFocused, setTerminalFocused] = createSignal(false)
  const [restoreTerminalFocus, setRestoreTerminalFocus] = createSignal(false)
  let focusTerminal: (() => void) | undefined
  createResource(
    () => props.sessionID,
    (sessionID) => sessions.load(sessionID).catch(() => undefined),
  )
  const session = () => sessions.get(props.sessionID)
  const terminals = () => session()?.terminals ?? []
  const selectedTerminal = () => {
    const value = session()
    return value?.terminals.find((terminal) => terminal.id === value.selectedTerminalID) ?? value?.terminals.at(-1)
  }
  createEffect(
    on(
      () => selectedTerminal()?.id,
      () => setSidebarSelected(false),
      { defer: true },
    ),
  )
  createEffect(() => {
    const terminal = selectedTerminal()
    if (terminal && sessions.shouldFocus(terminal.id)) setSidebarSelected(false)
  })
  const wide = createMemo(() => dimensions().width - props.verticalTabsWidth > 120)
  const sidebarVisible = createMemo(() => {
    if (data.session.get(props.sessionID)?.parentID) return false
    if (sidebarOpen()) return true
    return (config.data.session?.sidebar ?? "auto") === "auto" && wide()
  })
  const showSidebar = () => sidebarVisible() && (!selectedTerminal() || sidebarSelected())
  const showTerminal = () => !!selectedTerminal() && !showSidebar()
  const overlaySidebar = () => showSidebar() && !wide()
  const rightVisible = () => showTerminal() || (showSidebar() && !overlaySidebar())
  const rightWidth = createAnimatable(
    { width: SESSION_SIDEBAR_WIDTH },
    {
      transition: tween({ duration: 0.2, ease: (progress) => 1 - (1 - progress) ** 3 }),
      enabled: () => config.data.animations ?? true,
    },
  )
  createEffect(() => {
    const width = showTerminal()
      ? Math.max(1, Math.floor((dimensions().width - props.verticalTabsWidth) / 2))
      : SESSION_SIDEBAR_WIDTH
    rightWidth.animate({ width })
  })
  const toggleSidebar = () => {
    batch(() => {
      const visible = showSidebar()
      void config
        .update((draft) => {
          draft.session = { ...draft.session, sidebar: visible ? "hide" : "auto" }
        })
        .catch(toast.error)
      setSidebarOpen(!visible)
      setSidebarSelected(!visible)
    })
  }
  createEffect(() => {
    if (!restoreTerminalFocus() || terminals().length > 0) return
    setRestoreTerminalFocus(false)
    prompt.current?.focus()
  })
  Keymap.createLayer(() => ({
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
          setSidebarSelected(false)
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
          sidebarVisible={showSidebar()}
          onToggleSidebar={toggleSidebar}
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
      <Show when={rightVisible()}>
        <box flexShrink={0} width={Math.round(rightWidth.value().width)} minWidth={0} minHeight={0}>
          <Show
            when={showSidebar()}
            fallback={
              <Show keyed when={selectedTerminal()}>
                {(terminal) => (
                  <TerminalPanel
                    info={terminal}
                    onFocusChange={setTerminalFocused}
                    onFocusRequest={(value) => (focusTerminal = value)}
                    restoreFocus={restoreTerminalFocus()}
                    onAutoFocus={() => setRestoreTerminalFocus(false)}
                    onDisconnect={() => setRestoreTerminalFocus(true)}
                  />
                )}
              </Show>
            }
          >
            <Sidebar sessionID={props.sessionID} fill />
          </Show>
        </box>
      </Show>
      <Show when={overlaySidebar()}>
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

function TerminalPanel(props: {
  info: PersistentPtyInfo
  onFocusChange: (focused: boolean) => void
  onFocusRequest: (focus: (() => void) | undefined) => void
  restoreFocus: boolean
  onAutoFocus: () => void
  onDisconnect: () => void
}) {
  const sessions = useSessionTerminals()
  return (
    <TerminalPane
      ptyID={props.info.id}
      autoFocus={props.restoreFocus || sessions.shouldFocus(props.info.id)}
      onAutoFocus={() => {
        sessions.clearFocus(props.info.id)
        props.onAutoFocus()
      }}
      onFocusRequest={props.onFocusRequest}
      onDisconnect={props.onDisconnect}
      onFocusChange={props.onFocusChange}
    />
  )
}
