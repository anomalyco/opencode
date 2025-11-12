import type { Component } from "solid-js"
import { For, createSignal, createMemo } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"
import { useBejazzle } from "../context/bejazzle"

interface SessionsPanelProps {
  sessions: Array<{ id: string; title: string; hasChildren?: boolean; parentID?: string }>
  selectedId: string | null
  onSelect: (id: string) => void
  onCollapse?: () => void
  inputText?: string
  onInput?: (text: string) => void
  cursorVisible?: boolean
  width?: number
}

export const SessionsPanel: Component<SessionsPanelProps> = (props) => {
  const bejazzle = useBejazzle()
  const [expandedSessions, setExpandedSessions] = createSignal<Set<string>>(new Set())
  const [dateGroupExpanded, setDateGroupExpanded] = createSignal(true)

  // Calculate responsive widths based on panel width (fill entire width minus left margin)
  const panelWidth = () => props.width || 20
  const childMaxWidth = () => panelWidth() - 6 // Child sessions (indented at col 6)
  const parentMaxWidth = () => panelWidth() - 4 // Parent sessions with arrow (text starts at col 4)
  const regularMaxWidth = () => panelWidth() - 4 // Regular sessions (text starts at col 4)

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }

  // Agent colors mapping
  const agentColors: Record<string, string> = {
    GENERAL: "#61afef",
    ORCHESTRATOR: "#c678dd",
    PLAN: "#98c379",
    DOCS: "#e5c07b",
  }

  // Create list of visible sessions with their row positions
  const visibleSessions = createMemo(() => {
    let rowIndex = 0
    return props.sessions
      .filter((session) => {
        // Include if not a child, or if parent is expanded
        return !session.parentID || expandedSessions().has(session.parentID)
      })
      .map((session) => {
        // Transform title: remove "(@agent subagent)" and extract agent type
        let displayTitle = session.title
        let agentTag = null
        let agentColor = null

        if (session.parentID) {
          // Remove "(@agent subagent)" from the end
          displayTitle = displayTitle.replace(/\s*\(@\w+\s+subagent\)\s*$/, "")
          // Extract agent type from original title
          const agentMatch = session.title.match(/\(@(\w+)\s+subagent\)/)
          if (agentMatch) {
            const agentType = agentMatch[1].toUpperCase()
            agentTag = agentType
            agentColor = agentColors[agentType] || "#858585"
          }
        }
        return {
          ...session,
          displayTitle,
          agentTag,
          agentColor,
          row: 4 + rowIndex++,
        }
      })
  })

  return (
    <GridPanel
      col={0}
      row={0}
      width={props.width || 20}
      height="100%"
      bg="#0a0a0a"
      class="sidebar-panel-left"
      style={{
        "border-radius": bejazzle.themeFeatures().roundedCorners ? "1rem" : "0",
        overflow: "visible",
        "font-family": "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Header */}
      <GridText col={1} row={1} text="SESSIONS" fg="#858585" bold />
      <GridText col={panelWidth() - 2} row={1} text="◀" fg="#858585" onClick={props.onCollapse} />

      {/* Today group at row 3 */}
      <GridText
        col={1}
        row={3}
        text={`${dateGroupExpanded() ? "▼" : "▶"} Today (14)`}
        fg="#858585"
        onClick={() => setDateGroupExpanded(!dateGroupExpanded())}
      />

      {/* Session list starting at row 4 */}
      {dateGroupExpanded() && (
        <For each={visibleSessions()}>
          {(session) => {
            const isSelected = props.selectedId === session.id

            // Child sessions (indented)
            if (session.parentID) {
              return (
                <>
                  {/* Agent badge */}
                  {session.agentTag && (
                    <GridText
                      col={6}
                      row={session.row}
                      text={session.agentTag}
                      fg="#000000"
                      bg={session.agentColor}
                      bold
                      onClick={() => props.onSelect(session.id)}
                      style={{
                        padding: "0 0.5ch",
                        "border-radius": bejazzle.themeFeatures().roundedCorners ? "0.25rem" : "0",
                      }}
                    />
                  )}
                  {/* Task title */}
                  <GridText
                    col={6 + (session.agentTag ? session.agentTag.length + 2 : 0)}
                    row={session.row}
                    text={session.displayTitle}
                    fg={isSelected ? "#d19a66" : session.agentColor || "#ffffff"}
                    bg={isSelected ? "#2a2a2a" : undefined}
                    onClick={() => props.onSelect(session.id)}
                    style={{
                      "max-width": `${childMaxWidth() - (session.agentTag ? session.agentTag.length + 2 : 0)}ch`,
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                    }}
                  />
                </>
              )
            }

            // Parent sessions with children (has arrow)
            if (session.hasChildren) {
              const isExpanded = expandedSessions().has(session.id)
              const arrow = isExpanded ? "▼" : "▶"
              return (
                <>
                  <GridText
                    col={2}
                    row={session.row}
                    text={arrow}
                    fg={isSelected ? "#d19a66" : "#b0b0b0"}
                    bg={isSelected ? "#2a2a2a" : undefined}
                    onClick={() => {
                      props.onSelect(session.id)
                      toggleSession(session.id)
                    }}
                  />
                  <GridText
                    col={4}
                    row={session.row}
                    text={session.displayTitle}
                    fg={isSelected ? "#d19a66" : "#b0b0b0"}
                    bg={isSelected ? "#2a2a2a" : undefined}
                    onClick={() => {
                      props.onSelect(session.id)
                      toggleSession(session.id)
                    }}
                    style={{
                      "max-width": `${parentMaxWidth()}ch`,
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                    }}
                  />
                </>
              )
            }

            // Sessions without children (no arrow)
            return (
              <GridText
                col={4}
                row={session.row}
                text={session.displayTitle}
                fg={isSelected ? "#d19a66" : "#b0b0b0"}
                bg={isSelected ? "#2a2a2a" : undefined}
                onClick={() => props.onSelect(session.id)}
                style={{
                  "max-width": `${regularMaxWidth()}ch`,
                  "white-space": "nowrap",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                }}
              />
            )
          }}
        </For>
      )}

      {/* New Session button at bottom - dynamic row based on content */}
      <GridText
        col={1}
        row={4 + props.sessions.length + 2}
        text="New Session"
        fg="#d19a66"
        onClick={() => console.log("New session")}
      />
    </GridPanel>
  )
}
