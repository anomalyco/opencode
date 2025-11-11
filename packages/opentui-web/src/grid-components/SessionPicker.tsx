import type { Component } from "solid-js"
import { createSignal, For, Show, createEffect, onMount, onCleanup } from "solid-js"

export interface Session {
  id: string
  title: string
  timestamp: number // Unix timestamp in milliseconds
}

interface SessionPickerProps {
  isOpen: boolean
  sessions: Session[]
  currentSessionId?: string
  onSelect: (sessionId: string) => void
  onClose: () => void
  onDelete?: (sessionId: string) => void
  onRename?: (sessionId: string) => void
}

interface GroupedSessions {
  label: string
  sessions: Session[]
}

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

const getDateLabel = (timestamp: number): string => {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  // Reset time parts for comparison
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate())

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return "Today"
  } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return "Yesterday"
  } else {
    // Format as "Mon Nov 10 2025"
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    const dayName = days[date.getDay()]
    const monthName = months[date.getMonth()]
    const day = date.getDate()
    const year = date.getFullYear()
    return `${dayName} ${monthName} ${day.toString().padStart(2, "0")} ${year}`
  }
}

const groupSessionsByDate = (sessions: Session[]): GroupedSessions[] => {
  // Sort sessions by timestamp (newest first)
  const sorted = [...sessions].sort((a, b) => b.timestamp - a.timestamp)

  const groups = new Map<string, Session[]>()

  sorted.forEach((session) => {
    const label = getDateLabel(session.timestamp)
    if (!groups.has(label)) {
      groups.set(label, [])
    }
    groups.get(label)!.push(session)
  })

  return Array.from(groups.entries()).map(([label, sessions]) => ({
    label,
    sessions,
  }))
}

export const SessionPicker: Component<SessionPickerProps> = (props) => {
  const [searchTerm, setSearchTerm] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const filteredSessions = () => {
    const term = searchTerm().toLowerCase()
    if (!term) return props.sessions

    return props.sessions.filter((session) => session.title.toLowerCase().includes(term))
  }

  const groupedSessions = () => {
    return groupSessionsByDate(filteredSessions())
  }

  // Flatten sessions for keyboard navigation
  const flatSessions = () => {
    return filteredSessions()
  }

  const handleSelect = (sessionId: string) => {
    props.onSelect(sessionId)
    props.onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const allSessions = flatSessions()

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allSessions.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const session = allSessions[selectedIndex()]
      if (session) {
        handleSelect(session.id)
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      props.onClose()
    } else if (e.ctrlKey && e.key === "d") {
      e.preventDefault()
      const session = allSessions[selectedIndex()]
      if (session && props.onDelete) {
        props.onDelete(session.id)
      }
    } else if (e.ctrlKey && e.key === "r") {
      e.preventDefault()
      const session = allSessions[selectedIndex()]
      if (session && props.onRename) {
        props.onRename(session.id)
      }
    }
  }

  // Focus input and reset state when opened
  createEffect(() => {
    if (props.isOpen && inputRef) {
      setTimeout(() => {
        inputRef?.focus()
      }, 0)
      setSearchTerm("")
      setSelectedIndex(0)
    }
  })

  // Reset selection when search changes
  const handleSearchInput = (value: string) => {
    setSearchTerm(value)
    setSelectedIndex(0)
  }

  // Track current index for sessions in flat list
  let currentIndex = 0

  return (
    <Show when={props.isOpen}>
      {/* Overlay backdrop */}
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          bottom: "0",
          background: "rgba(0, 0, 0, 0.85)",
          "z-index": "2000",
          display: "flex",
          "align-items": "flex-start",
          "justify-content": "center",
          "padding-top": "15vh",
        }}
      >
        {/* Session picker box */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "#0a0a0a",
            border: "1px solid #2a2a2a",
            "border-radius": "4px",
            width: "90%",
            "max-width": "700px",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
            "line-height": "1.2",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "1em 1.5em",
              "border-bottom": "1px solid #2a2a2a",
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
            }}
          >
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>Sessions</span>
            <span style={{ color: "#6a6a6a", "font-size": "14px" }}>esc</span>
          </div>

          {/* Search input */}
          <div
            style={{
              padding: "1em 1.5em",
              "border-bottom": "1px solid #2a2a2a",
            }}
          >
            <input
              ref={inputRef}
              type="text"
              placeholder="Enter search term"
              value={searchTerm()}
              onInput={(e) => handleSearchInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              autofocus
              style={{
                width: "100%",
                background: "transparent",
                color: "#ffffff",
                border: "none",
                outline: "none",
                "font-family": "inherit",
                "font-size": "inherit",
                padding: "0",
                "caret-color": "#ff9800",
              }}
            />
          </div>

          {/* Session list */}
          <div
            style={{
              "max-height": "500px",
              "overflow-y": "auto",
              padding: "1em 0",
            }}
            class="terminal-scrollbar"
          >
            <Show
              when={flatSessions().length > 0}
              fallback={
                <div
                  style={{
                    padding: "2em",
                    "text-align": "center",
                    color: "#6a6a6a",
                  }}
                >
                  No sessions found
                </div>
              }
            >
              <For each={groupedSessions()}>
                {(group) => {
                  const groupStartIndex = currentIndex
                  currentIndex += group.sessions.length
                  return (
                    <div style={{ "margin-bottom": "0.25em" }}>
                      {/* Date header */}
                      <div
                        style={{
                          padding: "0.4em 1.5em 0.2em 1.5em",
                          color: "#ff9800",
                          "font-weight": "bold",
                        }}
                      >
                        {group.label}
                      </div>

                      {/* Group sessions */}
                      <For each={group.sessions}>
                        {(session, index) => {
                          const sessionIndex = groupStartIndex + index()
                          const isSelected = () => selectedIndex() === sessionIndex
                          const isCurrent = () => props.currentSessionId === session.id
                          return (
                            <div
                              onClick={() => handleSelect(session.id)}
                              style={{
                                padding: "0.35em 1.5em",
                                background: isCurrent() || isSelected() ? "#ff9800" : "transparent",
                                color: isCurrent() || isSelected() ? "#000000" : "#ffffff",
                                cursor: "pointer",
                                display: "flex",
                                "justify-content": "space-between",
                                "align-items": "center",
                                transition: "background 0.1s ease",
                              }}
                              onMouseEnter={() => setSelectedIndex(sessionIndex)}
                            >
                              <span
                                style={{
                                  flex: "1",
                                  overflow: "hidden",
                                  "text-overflow": "ellipsis",
                                  "white-space": "nowrap",
                                }}
                              >
                                {session.title}
                              </span>
                              <span
                                style={{
                                  "font-size": "14px",
                                  color: isCurrent() || isSelected() ? "#000000" : "#6a6a6a",
                                  "margin-left": "1em",
                                  "flex-shrink": "0",
                                }}
                              >
                                {formatTimestamp(session.timestamp)}
                              </span>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  )
                }}
              </For>
            </Show>
          </div>

          {/* Footer with keyboard hints */}
          <div
            style={{
              padding: "0.75em 1.5em",
              "border-top": "1px solid #2a2a2a",
              color: "#6a6a6a",
              "font-size": "14px",
              display: "flex",
              gap: "1em",
            }}
          >
            <Show when={props.onDelete}>
              <span>ctrl+d delete</span>
            </Show>
            <Show when={props.onRename}>
              <span>ctrl+r rename</span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
