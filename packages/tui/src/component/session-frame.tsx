import { RGBA, MouseEvent, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import {
  batch,
  createComponent,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useSessionTerminals } from "../context/session-terminals"
import { usePromptRef } from "../context/prompt"
import { useSessionPanel } from "../context/session-panel"
import { useStorage } from "../context/storage"
import { useTheme } from "../context/theme"
import { Session } from "../routes/session"
import { Sidebar } from "../routes/session/sidebar"
import { clampSessionPaneWidth, SESSION_SIDEBAR_WIDTH } from "../ui/layout"
import { createPaneResize } from "../ui/pane-resize"
import { PaneResizeHandle } from "../ui/pane-resize-handle"
import { useToast } from "../ui/toast"
import { TerminalPane } from "./terminal-pane"

export function SessionFrame(props: { sessionID: string; verticalTabsWidth: number }) {
  const sessions = useSessionTerminals()
  const prompt = usePromptRef()
  const config = useConfig()
  const data = useData()
  const toast = useToast()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const panel = useSessionPanel()
  const elevated = useTheme("elevated")
  const availableWidth = () => Math.max(0, dimensions().width - props.verticalTabsWidth)
  const defaultPaneWidth = () => Math.max(1, Math.floor(dimensions().width / 2))
  const [layout, updateLayout] = useStorage().store<{ paneWidth?: number; terminalWidth?: number }>("layout", {
    initial: {},
  })
  const paneResize = createPaneResize({
    value: () => layout.paneWidth ?? layout.terminalWidth ?? defaultPaneWidth(),
    defaultValue: defaultPaneWidth,
    clamp: (width) => clampSessionPaneWidth(width, availableWidth()),
    fromMouse: (event) => dimensions().width - event.x - 1,
    contains: (event, width) => event.x >= dimensions().width - width - 1 && event.x <= dimensions().width - width,
    onCommit: (width) => {
      void updateLayout((draft) => {
        draft.paneWidth = width
      }).catch((error) => console.error("Failed to persist TUI layout", error))
    },
  })
  let resizeRelease = false
  const finishPaneResize = (event: MouseEvent) => {
    if (paneResize.resizing()) {
      // A captured drag-end can be followed by mouse-up on the focus overlay.
      resizeRelease = true
      queueMicrotask(() => {
        resizeRelease = false
      })
    }
    paneResize.onMouseUp(event)
  }
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [sessionWidth, setSessionWidth] = createSignal<number>()
  const [terminalFocused, setTerminalFocused] = createSignal(false)
  const [panelFocused, setPanelFocused] = createSignal(false)
  const [restoreTerminalFocus, setRestoreTerminalFocus] = createSignal(false)
  let focusTerminal: (() => void) | undefined
  let sessionScroll: ScrollBoxRenderable | undefined
  let focusPanel: (() => void) | undefined
  createResource(
    () => (config.data.session.terminal ? props.sessionID : undefined),
    (sessionID) => sessions.refresh(sessionID).catch(() => undefined),
  )
  const session = () => sessions.get(props.sessionID)
  const selectedTerminal = () => {
    if (!config.data.session.terminal) return
    const value = session()
    return value.terminals.find((terminal) => terminal.id === value.selectedTerminalID)
  }
  const activePanel = createMemo(() => {
    const current = panel.current()
    if (current?.sessionID === props.sessionID) return current
  })
  createEffect(
    on(
      () => selectedTerminal()?.id,
      (id) => {
        if (!id) return
        setSidebarOpen(false)
        if (activePanel()) panel.close()
      },
      { defer: true },
    ),
  )
  const splitAvailable = createMemo(() => dimensions().width > 80)
  const wide = createMemo(() => dimensions().width - props.verticalTabsWidth > 120)
  createEffect(() => panel.setAvailable(props.sessionID, splitAvailable()))
  onCleanup(() => panel.setAvailable(props.sessionID, false))
  createEffect(() => {
    const current = activePanel()
    if (!current || splitAvailable()) return
    panel.close()
    current.onUnavailable?.()
  })
  createEffect(() => {
    if (!activePanel()) return
    setSidebarOpen(false)
    if (selectedTerminal()) void sessions.selectTerminal(props.sessionID, null).catch(toast.error)
  })
  const sidebarVisible = createMemo(() => {
    if (data.session.get(props.sessionID)?.parentID) return false
    if (sidebarOpen()) return true
    return (config.data.session?.sidebar ?? "auto") === "auto" && wide()
  })
  const rightPane = createMemo(() => {
    if (activePanel()) return "panel"
    if (sidebarOpen() && sidebarVisible()) return "sidebar"
    if (selectedTerminal()) return "terminal"
    if (sidebarVisible()) return "sidebar"
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
      if (!visible && activePanel()) panel.close()
      if (!visible && selectedTerminal()) void sessions.selectTerminal(props.sessionID, null).catch(toast.error)
    })
  }
  const focusSession = () => {
    // Permission prompts replace the input, so returning focus must not depend on it.
    if (terminalFocused() || panelFocused()) renderer.currentFocusedRenderable?.blur()
    prompt.current?.focus()
  }
  const focusRightPane = () => {
    if (activePanel()) {
      focusPanel?.()
      return
    }
    focusTerminal?.()
  }
  createEffect(
    on(
      () => activePanel()?.id,
      (id) => {
        if (!id) {
          setPanelFocused(false)
          return
        }
        requestAnimationFrame(() => {
          if (activePanel()?.id !== id) return
          focusPanel?.()
        })
      },
    ),
  )
  createEffect(() => {
    if (!restoreTerminalFocus() || selectedTerminal()) return
    setRestoreTerminalFocus(false)
    focusSession()
  })
  Keymap.createLayer(() => ({
    enabled: () => config.data.session.terminal === true || activePanel() !== undefined,
    commands: [
      {
        id: "pane.focus.left",
        title: "Focus session pane",
        run: focusSession,
      },
      {
        id: "pane.focus.right",
        title: "Focus right pane",
        run: focusRightPane,
      },
    ],
  }))

  return (
    <box
      flexGrow={1}
      minWidth={0}
      minHeight={0}
      flexDirection="row"
      position="relative"
      onMouseDrag={paneResize.onMouseDrag}
      onMouseDragEnd={finishPaneResize}
      onMouseUp={finishPaneResize}
    >
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
          scrollRef={(value) => (sessionScroll = value)}
          verticalTabsWidth={props.verticalTabsWidth}
          promptMuted={terminalFocused() || panelFocused()}
          sidebarVisible={rightPane() === "sidebar"}
          onToggleSidebar={toggleSidebar}
          visibleTerminalID={rightPane() === "terminal" ? selectedTerminal()?.id : undefined}
          width={sessionWidth()}
        />
        <Show when={terminalFocused() || panelFocused()}>
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            zIndex={1}
            onMouseScroll={(event) => {
              if (!sessionScroll || sessionScroll.isDestroyed) return
              const viewport = sessionScroll.viewport
              if (event.x < viewport.x || event.x >= viewport.x + viewport.width) return
              if (event.y < viewport.y || event.y >= viewport.y + viewport.height) return
              // Keep the focus-only click guard, but let the transcript handle its own wheel events.
              event.stopPropagation()
              sessionScroll.processMouseEvent(new MouseEvent(sessionScroll, event))
            }}
            // Consume the release before revealing permission buttons underneath.
            onMouseUp={() => {
              if (paneResize.resizing() || resizeRelease) return
              focusSession()
            }}
          />
        </Show>
      </box>
      <Show when={rightPane() === "terminal" || rightPane() === "panel" || (rightPane() === "sidebar" && wide())}>
        <box
          flexShrink={0}
          width={rightPane() === "terminal" || rightPane() === "panel" ? paneResize.size() : SESSION_SIDEBAR_WIDTH}
          minWidth={0}
          minHeight={0}
          backgroundColor={rightPane() === "panel" ? elevated.background.default : undefined}
        >
          <Show
            when={rightPane() === "sidebar"}
            fallback={
              <Show
                keyed
                when={activePanel()}
                fallback={
                  <Show keyed when={selectedTerminal()?.id}>
                    {(ptyID) => (
                      <TerminalPane
                        ptyID={ptyID}
                        resizing={paneResize.resizing()}
                        autoFocus={restoreTerminalFocus() || sessions.shouldFocus(ptyID)}
                        onAutoFocus={() => {
                          sessions.clearFocus(ptyID)
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
                {(item) =>
                  createComponent(item.render, {
                    get width() {
                      return paneResize.size()
                    },
                    get resizing() {
                      return paneResize.resizing()
                    },
                    get focused() {
                      return panelFocused()
                    },
                    onFocusChange: setPanelFocused,
                    onFocusRequest: (value) => (focusPanel = value),
                    close: panel.close,
                  })
                }
              </Show>
            }
          >
            <Sidebar sessionID={props.sessionID} />
          </Show>
        </box>
      </Show>
      <Show when={(rightPane() === "terminal" || rightPane() === "panel") && availableWidth() >= 3}>
        <PaneResizeHandle resize={paneResize} left={availableWidth() - paneResize.size() - 1} highlight="right" />
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
