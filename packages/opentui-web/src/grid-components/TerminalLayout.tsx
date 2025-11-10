import type { Component } from "solid-js"
import { createSignal } from "solid-js"
import { SessionsPanel } from "./SessionsPanel"
import { MessagesPanel } from "./MessagesPanel"
import { SidebarPanel } from "./SidebarPanel"
import { GridDivider } from "./GridDivider"

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
}

export const TerminalLayout: Component<TerminalLayoutProps> = (props) => {
  // Draggable column widths
  const [leftWidth, setLeftWidth] = createSignal(43)
  const [rightWidth, setRightWidth] = createSignal(38)

  // Panel collapse state
  const [leftCollapsed, setLeftCollapsed] = createSignal(false)
  const [rightCollapsed, setRightCollapsed] = createSignal(false)

  const leftDividerCol = () => (leftCollapsed() ? 0 : leftWidth())
  const rightDividerCol = () => (rightCollapsed() ? 157 : 157 - rightWidth())

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
        background: "#0a0a0a",
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
      {/* Main content area - grows to fill space */}
      <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
        {/* Left Panel - Sessions (only show if not collapsed) */}
        {!leftCollapsed() && (
          <SessionsPanel
            sessions={props.sessions}
            selectedId={props.selectedSessionId}
            onSelect={props.onSelectSession}
            onCollapse={() => setLeftCollapsed(true)}
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

        {/* Draggable divider after left panel */}
        <GridDivider col={leftDividerCol()} minCol={30} maxCol={60} onDrag={(newCol) => setLeftWidth(newCol)} />

        {/* Center Panel - Messages */}
        <MessagesPanel
          col={leftDividerCol() + 1}
          width={rightDividerCol() - leftDividerCol() - 1}
          messages={props.messages}
          inputText={props.inputText}
          onInput={props.onInput}
          onSubmit={props.onSubmit}
        />

        {/* Draggable divider before right panel */}
        <GridDivider
          col={rightDividerCol()}
          minCol={100}
          maxCol={130}
          onDrag={(newCol) => setRightWidth(157 - newCol)}
          alwaysVisible
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
        {/* Footer - single line */}
        <div
          style={{
            height: "1.2em",
            background: "#0a0a0a",
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
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>tab</span> agent
          </span>
        </div>
      </div>
    </div>
  )
}
