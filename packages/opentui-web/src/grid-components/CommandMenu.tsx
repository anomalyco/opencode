import type { Component } from "solid-js"
import { createSignal, For, Show, createEffect } from "solid-js"

interface Command {
  id: string
  label: string
  description: string
  group: string
  keybind?: string
  action: () => void
  disabled?: boolean
}

interface CommandMenuProps {
  isOpen: boolean
  onClose: () => void
  // Session commands
  onNewSession: () => void
  onSwitchSession: () => void
  onSessionTimeline?: () => void
  onSessionCompact?: () => void
  onSessionExport?: () => void
  onSessionShare?: () => void
  onSessionInterrupt?: () => void
  // Agent/Model commands
  onSwitchModel: () => void
  onSwitchAgent: () => void
  onModelCycle?: () => void
  onAgentCycle?: () => void
  // View commands
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
  onToggleBothSidebars: () => void
  // Message commands
  onMessagesCopy?: () => void
  onMessagesUndo?: () => void
  onMessagesRedo?: () => void
  onToggleConceal?: () => void
  // System commands
  onViewStatus?: () => void
  onSwitchTheme?: () => void
  onHelp?: () => void
}

export const CommandMenu: Component<CommandMenuProps> = (props) => {
  const [searchTerm, setSearchTerm] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const commands = (): Command[] => [
    // Session category
    {
      id: "session.new",
      label: "New session",
      description: "Create a new session",
      group: "Session",
      keybind: "ctrl+x n",
      action: props.onNewSession,
    },
    {
      id: "session.list",
      label: "Switch session",
      description: "List and switch to another session",
      group: "Session",
      keybind: "ctrl+x l",
      action: props.onSwitchSession,
    },
    {
      id: "session.timeline",
      label: "Jump to message",
      description: "Show session timeline to jump to a message",
      group: "Session",
      keybind: "ctrl+x g",
      action: props.onSessionTimeline || (() => console.log("Session timeline")),
      disabled: !props.onSessionTimeline,
    },
    {
      id: "session.compact",
      label: "Compact session",
      description: "Compact the current session",
      group: "Session",
      keybind: "ctrl+x c",
      action: props.onSessionCompact || (() => console.log("Compact session")),
      disabled: !props.onSessionCompact,
    },
    {
      id: "session.export",
      label: "Export session",
      description: "Export session to external editor",
      group: "Session",
      keybind: "ctrl+x x",
      action: props.onSessionExport || (() => console.log("Export session")),
      disabled: !props.onSessionExport,
    },
    {
      id: "session.share",
      label: "Share session",
      description: "Share the current session",
      group: "Session",
      action: props.onSessionShare || (() => console.log("Share session")),
      disabled: !props.onSessionShare,
    },
    {
      id: "session.interrupt",
      label: "Interrupt session",
      description: "Interrupt the current session",
      group: "Session",
      keybind: "esc",
      action: props.onSessionInterrupt || (() => console.log("Interrupt session")),
      disabled: !props.onSessionInterrupt,
    },

    // Agent category
    {
      id: "model.list",
      label: "Switch model",
      description: "Change the AI model",
      group: "Agent",
      keybind: "ctrl+x m",
      action: props.onSwitchModel,
    },
    {
      id: "model.cycle",
      label: "Cycle model (next)",
      description: "Switch to next recently used model",
      group: "Agent",
      keybind: "F2",
      action: props.onModelCycle || (() => console.log("Cycle model")),
      disabled: !props.onModelCycle,
    },
    {
      id: "agent.list",
      label: "Switch agent",
      description: "Change the current agent",
      group: "Agent",
      keybind: "ctrl+x a",
      action: props.onSwitchAgent,
    },
    {
      id: "agent.cycle",
      label: "Cycle agent (next)",
      description: "Switch to next agent",
      group: "Agent",
      keybind: "tab",
      action: props.onAgentCycle || (() => console.log("Cycle agent")),
      disabled: !props.onAgentCycle,
    },

    // View category
    {
      id: "sidebar.left.toggle",
      label: "Toggle sessions panel",
      description: "Show/hide the left sessions panel",
      group: "View",
      keybind: "ctrl+[",
      action: props.onToggleLeftSidebar,
    },
    {
      id: "sidebar.right.toggle",
      label: "Toggle sidebar panel",
      description: "Show/hide the right sidebar panel",
      group: "View",
      keybind: "ctrl+]",
      action: props.onToggleRightSidebar,
    },
    {
      id: "sidebar.both.toggle",
      label: "Toggle both sidebars",
      description: "Show/hide both sidebar panels",
      group: "View",
      keybind: "ctrl+b",
      action: props.onToggleBothSidebars,
    },
    {
      id: "messages.conceal",
      label: "Toggle code concealment",
      description: "Show/hide code blocks in messages",
      group: "View",
      keybind: "ctrl+x h",
      action: props.onToggleConceal || (() => console.log("Toggle conceal")),
      disabled: !props.onToggleConceal,
    },

    // Messages category
    {
      id: "messages.copy",
      label: "Copy message",
      description: "Copy selected message to clipboard",
      group: "Messages",
      keybind: "ctrl+x y",
      action: props.onMessagesCopy || (() => console.log("Copy message")),
      disabled: !props.onMessagesCopy,
    },
    {
      id: "messages.undo",
      label: "Undo message",
      description: "Undo the last message",
      group: "Messages",
      keybind: "ctrl+x u",
      action: props.onMessagesUndo || (() => console.log("Undo message")),
      disabled: !props.onMessagesUndo,
    },
    {
      id: "messages.redo",
      label: "Redo message",
      description: "Redo the last undone message",
      group: "Messages",
      keybind: "ctrl+x r",
      action: props.onMessagesRedo || (() => console.log("Redo message")),
      disabled: !props.onMessagesRedo,
    },

    // System category
    {
      id: "status.view",
      label: "View status",
      description: "Show system status and statistics",
      group: "System",
      keybind: "ctrl+x s",
      action: props.onViewStatus || (() => console.log("View status")),
      disabled: !props.onViewStatus,
    },
    {
      id: "theme.switch",
      label: "Switch theme",
      description: "Change the UI theme",
      group: "System",
      keybind: "ctrl+x t",
      action: props.onSwitchTheme || (() => console.log("Switch theme")),
      disabled: !props.onSwitchTheme,
    },
    {
      id: "help.show",
      label: "Help",
      description: "Show help and keyboard shortcuts",
      group: "System",
      action: props.onHelp || (() => console.log("Show help")),
      disabled: !props.onHelp,
    },
  ]

  const filteredCommands = () => {
    const term = searchTerm().toLowerCase()
    const allCommands = commands()
    if (!term) return allCommands.filter((cmd) => !cmd.disabled)

    return allCommands.filter(
      (cmd) =>
        !cmd.disabled &&
        (cmd.label.toLowerCase().includes(term) ||
          cmd.description.toLowerCase().includes(term) ||
          cmd.keybind?.toLowerCase().includes(term)),
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
    if (command.disabled) return
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
          "padding-top": "15vh",
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
            "max-width": "700px",
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
              placeholder="Type a command or search..."
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
              "max-height": "500px",
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
                          const isSelected = () => selectedIndex() === cmdIndex
                          return (
                            <div
                              onClick={() => handleSelect(cmd)}
                              style={{
                                padding: "0.75em 1.5em",
                                background: isSelected() ? "#ff9800" : "transparent",
                                color: isSelected() ? "#000000" : "#ffffff",
                                cursor: "pointer",
                                display: "flex",
                                "justify-content": "space-between",
                                "align-items": "flex-start",
                                gap: "1em",
                                transition: "background 0.1s ease",
                              }}
                              onMouseEnter={() => setSelectedIndex(cmdIndex)}
                            >
                              <div
                                style={{
                                  flex: "1",
                                  display: "flex",
                                  "flex-direction": "column",
                                  gap: "0.25em",
                                }}
                              >
                                <div
                                  style={{
                                    "font-weight": isSelected() ? "bold" : "normal",
                                  }}
                                >
                                  {cmd.label}
                                </div>
                                <div
                                  style={{
                                    "font-size": "14px",
                                    color: isSelected() ? "#000000" : "#858585",
                                  }}
                                >
                                  {cmd.description}
                                </div>
                              </div>
                              {cmd.keybind && (
                                <div
                                  style={{
                                    "font-size": "13px",
                                    color: isSelected() ? "#000000" : "#6a6a6a",
                                    "white-space": "nowrap",
                                    "flex-shrink": "0",
                                  }}
                                >
                                  {cmd.keybind}
                                </div>
                              )}
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
