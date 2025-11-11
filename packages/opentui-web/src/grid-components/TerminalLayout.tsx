import type { Component } from "solid-js"
import { createSignal, onMount, onCleanup } from "solid-js"
import { SessionsPanel } from "./SessionsPanel"
import { MessagesPanel } from "./MessagesPanel"
import { SidebarPanel } from "./SidebarPanel"
import { GridDivider } from "./GridDivider"
import { CommandMenu } from "./CommandMenu"
import { createKeyboardHandler, type KeyboardShortcut } from "../utils/keyboard"

interface TerminalLayoutProps {
  sessions: Array<{ id: string; title: string; hasChildren?: boolean }>
  messages: Array<any>
  todos: Array<any>
  subagents: Array<{
    id: string
    title: string
    status: "running" | "completed" | "failed"
    time: { created: number; updated: number }
  }>
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  inputText: string
  onInput: (text: string) => void
  onSubmit?: (text: string) => void
  currentAgent: string
}

export const TerminalLayout: Component<TerminalLayoutProps> = (props) => {
  console.log("[TerminalLayout] Rendering with todos:", props.todos, "length:", props.todos?.length)

  // Character width for Berkeley Mono at 16px
  const CHAR_WIDTH = 9.6

  // Calculate total columns based on window width
  const calculateTotalColumns = () => Math.floor(window.innerWidth / CHAR_WIDTH)

  // Reactive total columns signal
  const [totalCols, setTotalCols] = createSignal(calculateTotalColumns())

  // Draggable column widths
  const [leftWidth, setLeftWidth] = createSignal(43)
  const [rightWidth, setRightWidth] = createSignal(38)

  // Panel collapse state
  const [leftCollapsed, setLeftCollapsed] = createSignal(false)
  const [rightCollapsed, setRightCollapsed] = createSignal(false)

  // Command menu state
  const [commandMenuOpen, setCommandMenuOpen] = createSignal(false)

  const leftDividerCol = () => (leftCollapsed() ? 0 : leftWidth())
  const rightDividerCol = () => (rightCollapsed() ? totalCols() : totalCols() - rightWidth())

  // Scroll container ref for clear screen functionality
  const [messagesScrollContainer, setMessagesScrollContainer] = createSignal<HTMLDivElement | null>(null)

  // Window resize listener and keyboard shortcuts
  onMount(() => {
    const handleResize = () => {
      setTotalCols(calculateTotalColumns())
    }

    window.addEventListener("resize", handleResize)

    // Define all keyboard shortcuts
    const shortcuts: KeyboardShortcut[] = [
      {
        key: "p",
        ctrl: true,
        description: "Open command menu",
        action: () => setCommandMenuOpen(true),
      },
      {
        key: "n",
        ctrl: true,
        description: "New chat",
        action: handleNewChat,
      },
      {
        key: "s",
        ctrl: true,
        description: "Toggle sidebar",
        action: handleToggleSidebar,
      },
      {
        key: "l",
        ctrl: true,
        description: "Clear screen / scroll to bottom",
        action: handleClearScreen,
      },
      {
        key: "b",
        ctrl: true,
        description: "Toggle sessions panel",
        action: handleToggleSessions,
      },
      {
        key: "Escape",
        description: "Close command menu",
        action: () => {
          if (commandMenuOpen()) {
            setCommandMenuOpen(false)
          }
        },
      },
    ]

    // Setup keyboard handler
    const keyboardHandler = createKeyboardHandler({ shortcuts, enabled: true })
    keyboardHandler.attach()

    onCleanup(() => {
      window.removeEventListener("resize", handleResize)
      keyboardHandler.detach()
    })
  })

  // Command handlers
  const handleNewChat = () => {
    console.log("New chat requested")
    // TODO: Implement new chat creation
  }

  const handleClearHistory = () => {
    console.log("Clear history requested")
    // TODO: Implement clear history
  }

  const handleExportChat = () => {
    console.log("Export chat requested")
    // TODO: Implement export
  }

  const handleSettings = () => {
    console.log("Settings requested")
    // TODO: Implement settings
  }

  const handleToggleSidebar = () => {
    setRightCollapsed((prev) => !prev)
  }

  const handleToggleSessions = () => {
    setLeftCollapsed((prev) => !prev)
  }

  const handleClearScreen = () => {
    const container = messagesScrollContainer()
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        width: "100vw",
        height: "100vh",
        background: "#000000",
        overflow: "hidden",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        display: "flex",
        "flex-direction": "column",
        /* GPU acceleration for smooth resizing */
        transform: "translateZ(0)",
        "will-change": "transform",
        "-webkit-backface-visibility": "hidden",
        "-webkit-perspective": "1000",
      }}
    >
      {/* Dividers - positioned absolutely to span full height including footer */}
      <GridDivider
        col={leftDividerCol()}
        minCol={30}
        maxCol={60}
        onDrag={(newCol) => setLeftWidth(newCol)}
        style={{ position: "fixed", height: "100vh" }}
      />
      <GridDivider
        col={rightDividerCol()}
        minCol={totalCols() - 60}
        maxCol={totalCols() - 40}
        onDrag={(newCol) => setRightWidth(Math.max(40, totalCols() - newCol))}
        alwaysVisible
        style={{ position: "fixed", height: "100vh" }}
      />

      {/* Main content area - grows to fill space */}
      <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
        {/* Left Panel - Sessions (only show if not collapsed) */}
        {!leftCollapsed() && (
          <SessionsPanel
            sessions={props.sessions}
            selectedId={props.selectedSessionId}
            onSelect={props.onSelectSession}
            onCollapse={() => setLeftCollapsed(true)}
            width={leftWidth()}
          />
        )}

        {/* Show expand arrow if left panel is collapsed */}
        {leftCollapsed() && (
          <div
            onClick={() => setLeftCollapsed(false)}
            style={{
              position: "absolute",
              left: "0",
              top: "0",
              width: "2ch",
              height: "1.2em",
              background: "#1a1a1a",
              color: "#858585",
              cursor: "pointer",
              "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
              "font-size": "16px",
            }}
          >
            ▶
          </div>
        )}

        {/* Center Panel - Messages */}
        <MessagesPanel
          col={leftDividerCol() + 1}
          width={rightDividerCol() - leftDividerCol() - 1}
          messages={props.messages}
          inputText={props.inputText}
          onInput={props.onInput}
          onSubmit={props.onSubmit}
          onScrollContainerRef={setMessagesScrollContainer}
        />

        {/* Right Panel - Sidebar (only show if not collapsed) */}
        {!rightCollapsed() && (
          <SidebarPanel
            col={rightDividerCol() + 1}
            width={rightWidth()}
            todos={props.todos}
            subagents={props.subagents}
            onCollapse={() => setRightCollapsed(true)}
          />
        )}

        {/* Show expand arrow if right panel is collapsed */}
        {rightCollapsed() && (
          <div
            onClick={() => setRightCollapsed(false)}
            style={{
              position: "absolute",
              right: "0",
              top: "0",
              width: "2ch",
              height: "1.2em",
              background: "#1a1a1a",
              color: "#858585",
              cursor: "pointer",
              "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
              "font-size": "16px",
              "text-align": "right",
            }}
          >
            ◀
          </div>
        )}
      </div>

      {/* Bottom Bar - fixed height footer */}
      <div style={{ "flex-shrink": "0" }}>
        {/* Footer - single line - PURE BLACK */}
        <div
          style={{
            height: "1.2em",
            background: "#000000",
            color: "#858585",
            padding: "0 1ch",
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
          }}
        >
          <span>
            <span style={{ color: "#ffffff" }}>code</span>surf v0.0.0-dev-codesurf-202511101344{" "}
            ~/Documents/GitHub/flows/opencode-stt
          </span>
          <span>
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+p</span> menu{" "}
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+n</span> new{" "}
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+l</span> clear{" "}
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+s</span> sidebar{" "}
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>tab</span>{" "}
            <span style={{ color: "#61afef" }}>{props.currentAgent}</span>
          </span>
        </div>
      </div>

      {/* Command Menu */}
      <CommandMenu
        isOpen={commandMenuOpen()}
        onClose={() => setCommandMenuOpen(false)}
        onNewChat={handleNewChat}
        onClearHistory={handleClearHistory}
        onExportChat={handleExportChat}
        onSettings={handleSettings}
        onToggleSidebar={handleToggleSidebar}
        onToggleSessions={handleToggleSessions}
        onClearScreen={handleClearScreen}
      />
    </div>
  )
}
