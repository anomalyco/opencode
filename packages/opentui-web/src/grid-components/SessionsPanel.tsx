import type { Component } from "solid-js"
import { For, createSignal } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"
import { GridInput } from "./GridInput"

interface SessionsPanelProps {
  sessions: Array<{ id: string; title: string; hasChildren?: boolean; parentID?: string }>
  selectedId: string | null
  onSelect: (id: string) => void
  onCollapse?: () => void
  inputText?: string
  onInput?: (text: string) => void
  cursorVisible?: boolean
}

export const SessionsPanel: Component<SessionsPanelProps> = (props) => {
  const [expandedSessions, setExpandedSessions] = createSignal<Set<string>>(new Set())

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

  return (
    <GridPanel col={0} row={0} width={43} height="100%" bg="#0a0a0a">
      {/* Header */}
      <GridText col={0} row={0} text="SESSIONS" fg="#858585" bold />
      <GridText col={35} row={0} text="◀" fg="#858585" onClick={props.onCollapse} />

      {/* Blank row 1 */}

      {/* Today group at row 2 */}
      <GridText col={0} row={2} text="▼ Today (14)" fg="#858585" />

      {/* Session list starting at row 3 - simplified row calculation */}
      <For each={props.sessions.slice(0, 40)}>
        {(session, idx) => {
          const isSelected = props.selectedId === session.id
          const currentRow = 3 + idx()

          // Skip rendering if this is a child session and parent is not expanded
          if (session.parentID && !expandedSessions().has(session.parentID)) {
            return null
          }

          // Child sessions (indented)
          if (session.parentID) {
            return (
              <GridText
                col={6}
                row={currentRow}
                text={session.title.slice(0, 35)}
                fg={isSelected ? "#d19a66" : "#ffffff"}
                bg={isSelected ? "#2a2a2a" : undefined}
                onClick={() => props.onSelect(session.id)}
              />
            )
          }

          // Parent sessions with children (has arrow)
          if (session.hasChildren) {
            const isExpanded = expandedSessions().has(session.id)
            const arrow = isExpanded ? "▼" : "▶"
            return (
              <GridText
                col={2}
                row={currentRow}
                text={`${arrow} ${session.title.slice(0, 36)}`}
                fg={isSelected ? "#d19a66" : "#ffffff"}
                bg={isSelected ? "#2a2a2a" : undefined}
                onClick={() => {
                  props.onSelect(session.id)
                  toggleSession(session.id)
                }}
              />
            )
          }

          // Sessions without children (no arrow)
          return (
            <GridText
              col={4}
              row={currentRow}
              text={session.title.slice(0, 37)}
              fg={isSelected ? "#d19a66" : "#ffffff"}
              bg={isSelected ? "#2a2a2a" : undefined}
              onClick={() => props.onSelect(session.id)}
            />
          )
        }}
      </For>

      {/* New Session button at bottom */}
      <GridText col={0} row={65} text="+ New Session" fg="#d19a66" onClick={() => console.log("New session")} />
    </GridPanel>
  )
}
