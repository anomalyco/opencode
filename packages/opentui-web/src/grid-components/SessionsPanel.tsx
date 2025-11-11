import type { Component } from "solid-js"
import { For, createSignal, createMemo } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"
import { GridTextWrap, calculateWrappedRows } from "./GridTextWrap"
import { GridInput } from "./GridInput"

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
  const [expandedSessions, setExpandedSessions] = createSignal<Set<string>>(new Set())
  const [dateGroupExpanded, setDateGroupExpanded] = createSignal(true)

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

  // Calculate cumulative row offsets for each session
  const sessionRowOffsets = createMemo(() => {
    const offsets: number[] = []
    let currentOffset = 0

    props.sessions.slice(0, 40).forEach((session, idx) => {
      offsets[idx] = currentOffset

      // Skip if child and parent not expanded
      if (session.parentID && !expandedSessions().has(session.parentID)) {
        return
      }

      // Calculate max width based on session type
      let maxWidth = 37
      if (session.parentID) {
        maxWidth = 35 // Child sessions (indented)
      } else if (session.hasChildren) {
        maxWidth = 36 // Parent sessions with arrow
      }

      const rowsUsed = calculateWrappedRows(session.title, maxWidth)
      currentOffset += rowsUsed
    })

    return offsets
  })

  return (
    <GridPanel col={0} row={0} width={props.width || 43} height="100%" bg="#0a0a0a">
      {/* Header */}
      <GridText col={1} row={1} text="SESSIONS" fg="#858585" bold />
      <GridText col={36} row={1} text="◀" fg="#858585" onClick={props.onCollapse} />

      {/* Today group at row 3 */}
      <GridText
        col={1}
        row={3}
        text={`${dateGroupExpanded() ? "▼" : "▶"} Today (14)`}
        fg="#858585"
        onClick={() => setDateGroupExpanded(!dateGroupExpanded())}
      />

      {/* Session list starting at row 4 - with text wrapping */}
      {dateGroupExpanded() && (
        <For each={props.sessions.slice(0, 40)}>
          {(session, idx) => {
            const isSelected = props.selectedId === session.id
            const currentRow = 4 + (sessionRowOffsets()[idx()] || 0)

            // Skip rendering if this is a child session and parent is not expanded
            if (session.parentID && !expandedSessions().has(session.parentID)) {
              return null
            }

            // Child sessions (indented)
            if (session.parentID) {
              return (
                <GridTextWrap
                  col={6}
                  row={currentRow}
                  text={session.title}
                  maxWidth={35}
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
                <>
                  <GridText
                    col={2}
                    row={currentRow}
                    text={arrow}
                    fg={isSelected ? "#d19a66" : "#ffffff"}
                    bg={isSelected ? "#2a2a2a" : undefined}
                    onClick={() => {
                      props.onSelect(session.id)
                      toggleSession(session.id)
                    }}
                  />
                  <GridTextWrap
                    col={4}
                    row={currentRow}
                    text={session.title}
                    maxWidth={36}
                    fg={isSelected ? "#d19a66" : "#ffffff"}
                    bg={isSelected ? "#2a2a2a" : undefined}
                    onClick={() => {
                      props.onSelect(session.id)
                      toggleSession(session.id)
                    }}
                  />
                </>
              )
            }

            // Sessions without children (no arrow)
            return (
              <GridTextWrap
                col={4}
                row={currentRow}
                text={session.title}
                maxWidth={37}
                fg={isSelected ? "#d19a66" : "#ffffff"}
                bg={isSelected ? "#2a2a2a" : undefined}
                onClick={() => props.onSelect(session.id)}
              />
            )
          }}
        </For>
      )}

      {/* New Session button at bottom */}
      <GridText col={1} row={65} text="New Session" fg="#d19a66" onClick={() => console.log("New session")} />
    </GridPanel>
  )
}
