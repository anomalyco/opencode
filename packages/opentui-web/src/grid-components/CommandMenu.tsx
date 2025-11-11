import type { Component } from "solid-js"
import { createSignal, onMount, onCleanup, For, Show } from "solid-js"

interface Command {
  id: string
  label: string
  description: string
  group: string
  shortcut?: string
  action: () => void
}

interface CommandMenuProps {
  isOpen: boolean
  onClose: () => void
  onNewChat: () => void
  onClearHistory: () => void
  onExportChat: () => void
  onSettings: () => void
  onToggleSidebar: () => void
  onToggleSessions: () => void
  onClearScreen?: () => void
}

export const CommandMenu: Component<CommandMenuProps> = (props) => {
  const [searchTerm, setSearchTerm] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const commands = (): Command[] => [
    {
      id: "new-chat",
      label: "New Chat",
      description: "Create a new session",
      group: "Session",
      shortcut: "Ctrl+N",
      action: props.onNewChat,
    },
    {
      id: "clear-history",
      label: "Clear History",
      description: "Clear all messages in current session",
      group: "Session",
      action: props.onClearHistory,
    },
    {
      id: "export-chat",
      label: "Export Chat",
      description: "Export conversation to file",
      group: "Session",
      action: props.onExportChat,
    },
    {
      id: "toggle-sessions",
      label: "Toggle Sessions",
      description: "Show/hide sessions panel",
      group: "View",
      shortcut: "Ctrl+B",
      action: props.onToggleSessions,
    },
    {
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      description: "Show/hide sidebar panel",
      group: "View",
      shortcut: "Ctrl+S",
      action: props.onToggleSidebar,
    },
    {
      id: "clear-screen",
      label: "Clear Screen",
      description: "Scroll to bottom of messages",
      group: "View",
      shortcut: "Ctrl+L",
      action: () => props.onClearScreen?.(),
    },
    {
      id: "settings",
      label: "Settings",
      description: "Open settings",
      group: "General",
      action: props.onSettings,
    },
  ]

  const filteredCommands = () => {
    const term = searchTerm().toLowerCase()
    if (!term) return commands()
    return commands().filter(
      (cmd) => cmd.label.toLowerCase().includes(term) || cmd.description.toLowerCase().includes(term),
    )
  }

  const groupedCommands = () => {
    const items = filteredCommands()
    const groups = new Map<string, Command[]>()

    items.forEach((cmd) => {
      if (!groups.has(cmd.group)) {
        groups.set(cmd.group, [])
      }
      groups.get(cmd.group)!.push(cmd)
    })

    return Array.from(groups.entries())
  }

  const handleSelect = (command: Command) => {
    command.action()
    props.onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const allCommands = filteredCommands()

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allCommands.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const cmd = allCommands[selectedIndex()]
      if (cmd) {
        handleSelect(cmd)
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      props.onClose()
    }
  }

  onMount(() => {
    if (props.isOpen && inputRef) {
      inputRef.focus()
      setSearchTerm("")
      setSelectedIndex(0)
    }
  })

  // Reset selection when search changes
  const handleSearchInput = (value: string) => {
    setSearchTerm(value)
    setSelectedIndex(0)
  }

  // Track current index for commands in flat list
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
          "padding-top": "20vh",
        }}
      >
        {/* Command menu box */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "#1a1a1a",
            border: "1px solid #2a2a2a",
            "border-radius": "4px",
            width: "90%",
            "max-width": "600px",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
            "line-height": "1.2",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
          }}
        >
          {/* Search input */}
          <div
            style={{
              padding: "1em 1.5em",
              "border-bottom": "1px solid #2a2a2a",
              display: "flex",
              "align-items": "center",
              gap: "0.5em",
            }}
          >
            <span style={{ color: "#ff9800" }}>❯</span>
            <input
              ref={inputRef}
              type="text"
              placeholder="Type a command..."
              value={searchTerm()}
              onInput={(e) => handleSearchInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              autofocus
              style={{
                flex: "1",
                background: "transparent",
                color: "#ffffff",
                border: "none",
                outline: "none",
                "font-family": "inherit",
                "font-size": "inherit",
                padding: "0",
              }}
            />
            <span style={{ color: "#6a6a6a", "font-size": "14px" }}>esc</span>
          </div>

          {/* Command list */}
          <div
            style={{
              "max-height": "400px",
              "overflow-y": "auto",
              padding: "0.5em 0",
            }}
            class="terminal-scrollbar"
          >
            <Show
              when={filteredCommands().length > 0}
              fallback={
                <div
                  style={{
                    padding: "2em",
                    "text-align": "center",
                    color: "#6a6a6a",
                  }}
                >
                  No commands found
                </div>
              }
            >
              <For each={groupedCommands()}>
                {([groupName, groupCommands]) => {
                  const groupStartIndex = currentIndex
                  currentIndex += groupCommands.length
                  return (
                    <div style={{ "margin-bottom": "0.5em" }}>
                      {/* Group header */}
                      <div
                        style={{
                          padding: "0.5em 1.5em",
                          color: "#858585",
                          "font-size": "14px",
                          "font-weight": "bold",
                        }}
                      >
                        {groupName}
                      </div>

                      {/* Group commands */}
                      <For each={groupCommands}>
                        {(cmd, index) => {
                          const cmdIndex = groupStartIndex + index()
                          return (
                            <div
                              onClick={() => handleSelect(cmd)}
                              style={{
                                padding: "0.75em 1.5em",
                                background: selectedIndex() === cmdIndex ? "#ff9800" : "transparent",
                                color: selectedIndex() === cmdIndex ? "#000000" : "#ffffff",
                                cursor: "pointer",
                                display: "flex",
                                "justify-content": "space-between",
                                "align-items": "center",
                                transition: "background 0.1s ease",
                              }}
                              onMouseEnter={() => setSelectedIndex(cmdIndex)}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  "flex-direction": "column",
                                  gap: "0.25em",
                                }}
                              >
                                <div
                                  style={{
                                    "font-weight": selectedIndex() === cmdIndex ? "bold" : "normal",
                                  }}
                                >
                                  {cmd.label}
                                </div>
                                <div
                                  style={{
                                    "font-size": "14px",
                                    color: selectedIndex() === cmdIndex ? "#000000" : "#858585",
                                  }}
                                >
                                  {cmd.description}
                                </div>
                              </div>
                              <Show when={cmd.shortcut}>
                                <div
                                  style={{
                                    "font-size": "12px",
                                    color: selectedIndex() === cmdIndex ? "#000000" : "#858585",
                                    padding: "0.25em 0.5em",
                                    border: `1px solid ${selectedIndex() === cmdIndex ? "#000000" : "#2a2a2a"}`,
                                    "border-radius": "2px",
                                    "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
                                  }}
                                >
                                  {cmd.shortcut}
                                </div>
                              </Show>
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
        </div>
      </div>
    </Show>
  )
}
