import type { Component } from "solid-js"
import { createSignal, For, Show, createEffect, onMount, onCleanup } from "solid-js"

interface MessageAction {
  id: string
  label: string
  description: string
  keybind?: string
  action: () => void
  disabled?: boolean
}

interface MessageActionsDialogProps {
  isOpen: boolean
  onClose: () => void
  messageId: string
  messageText: string
  messageRole: "user" | "assistant"
  messageIndex: number
  hasToolParts?: boolean
  hasImageParts?: boolean
  // Action handlers
  onRevert?: () => void
  onFork?: () => void
  onCopy?: () => void
  onEdit?: () => void
  onBookmark?: () => void
  onExport?: () => void
  onDelete?: () => void
  // Context-saving handlers
  onDeleteTooling?: () => void
  onDeleteImages?: () => void
  onCompactMessage?: () => void
  onStripMetadata?: () => void
}

export const MessageActionsDialog: Component<MessageActionsDialogProps> = (props) => {
  const [searchTerm, setSearchTerm] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const actions = (): MessageAction[] => [
    // Primary actions
    {
      id: "revert",
      label: "Revert undo messages and file changes",
      description: "Undo this message and all subsequent file changes",
      action: props.onRevert || (() => console.log("Revert")),
      disabled: !props.onRevert,
    },
    {
      id: "fork",
      label: "Fork create a new session",
      description: "Create a new session from this message",
      action: props.onFork || (() => console.log("Fork")),
      disabled: !props.onFork,
    },
    {
      id: "copy",
      label: "Copy message",
      description: "Copy message content to clipboard",
      keybind: "ctrl+c",
      action:
        props.onCopy ||
        (() => {
          navigator.clipboard.writeText(props.messageText)
          console.log("Message copied to clipboard")
        }),
      disabled: !props.messageText,
    },
    {
      id: "edit",
      label: "Edit and resubmit",
      description: "Edit this message and regenerate response",
      action: props.onEdit || (() => console.log("Edit")),
      disabled: props.messageRole !== "user" || !props.onEdit,
    },
    {
      id: "bookmark",
      label: "Bookmark to knowledge base",
      description: "Save and classify this message in the knowledge base",
      action: props.onBookmark || (() => console.log("Bookmark to KB")),
      disabled: !props.onBookmark,
    },
    {
      id: "export",
      label: "Export message",
      description: "Download message as markdown or JSON",
      action: props.onExport || (() => console.log("Export")),
      disabled: !props.onExport,
    },

    // Context-saving actions
    {
      id: "delete-tooling",
      label: "Delete tooling data",
      description: "Remove tool inputs/outputs to save context tokens",
      action: props.onDeleteTooling || (() => console.log("Delete tooling")),
      disabled: !props.hasToolParts || !props.onDeleteTooling,
    },
    {
      id: "delete-images",
      label: "Delete images",
      description: "Remove image attachments to save context tokens",
      action: props.onDeleteImages || (() => console.log("Delete images")),
      disabled: !props.hasImageParts || !props.onDeleteImages,
    },
    {
      id: "compact-message",
      label: "Compact message",
      description: "Summarize this message to reduce token usage",
      action: props.onCompactMessage || (() => console.log("Compact message")),
      disabled: !props.onCompactMessage,
    },
    {
      id: "strip-metadata",
      label: "Strip metadata",
      description: "Remove timestamps and metadata to save tokens",
      action: props.onStripMetadata || (() => console.log("Strip metadata")),
      disabled: !props.onStripMetadata,
    },

    // Destructive actions
    {
      id: "delete",
      label: "Delete from here",
      description: "Remove this message and all following messages",
      action: props.onDelete || (() => console.log("Delete")),
      disabled: !props.onDelete,
    },
  ]

  const filteredActions = () => {
    const term = searchTerm().toLowerCase()
    const allActions = actions()
    if (!term) return allActions.filter((a) => !a.disabled)
    return allActions.filter(
      (a) => !a.disabled && (a.label.toLowerCase().includes(term) || a.description.toLowerCase().includes(term)),
    )
  }

  const handleSelect = (action: MessageAction) => {
    if (action.disabled) return
    action.action()
    props.onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const actions = filteredActions()
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, actions.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const action = actions[selectedIndex()]
      if (action) handleSelect(action)
    } else if (e.key === "Escape") {
      e.preventDefault()
      props.onClose()
    }
  }

  // Focus input when opened
  createEffect(() => {
    if (props.isOpen && inputRef) {
      setTimeout(() => {
        inputRef?.focus()
      }, 0)
      setSearchTerm("")
      setSelectedIndex(0)
    }
  })

  // Global keydown handler
  onMount(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (props.isOpen) {
        handleKeyDown(e)
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown)
    onCleanup(() => window.removeEventListener("keydown", handleGlobalKeyDown))
  })

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
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        {/* Dialog box */}
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
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>Message Actions</span>
            <span style={{ color: "#6a6a6a" }}>esc</span>
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
              onInput={(e) => {
                setSearchTerm(e.currentTarget.value)
                setSelectedIndex(0)
              }}
              autofocus
              style={{
                width: "100%",
                padding: "0.5em 1em",
                background: "#0a0a0a",
                color: "#ffffff",
                border: "1px solid #2a2a2a",
                "border-radius": "2px",
                "font-family": "inherit",
                "font-size": "inherit",
                outline: "none",
              }}
            />
          </div>

          {/* Actions list */}
          <div
            style={{
              "max-height": "400px",
              "overflow-y": "auto",
              padding: "0.5em 0",
            }}
            class="terminal-scrollbar"
          >
            <Show
              when={filteredActions().length > 0}
              fallback={
                <div
                  style={{
                    padding: "2em",
                    "text-align": "center",
                    color: "#6a6a6a",
                  }}
                >
                  No actions found
                </div>
              }
            >
              <For each={filteredActions()}>
                {(action, index) => {
                  const isSelected = () => selectedIndex() === index()
                  return (
                    <div
                      onClick={() => handleSelect(action)}
                      onMouseEnter={() => setSelectedIndex(index())}
                      style={{
                        padding: "0.75em 1.5em",
                        background: isSelected() ? "#d19a66" : "transparent",
                        color: isSelected() ? "#000000" : "#ffffff",
                        cursor: "pointer",
                        display: "flex",
                        "justify-content": "space-between",
                        "align-items": "flex-start",
                        gap: "1em",
                        transition: "background 0.1s ease",
                      }}
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
                          {action.label}
                        </div>
                        <div
                          style={{
                            "font-size": "14px",
                            color: isSelected() ? "#000000" : "#858585",
                          }}
                        >
                          {action.description}
                        </div>
                      </div>
                      {action.keybind && (
                        <div
                          style={{
                            "font-size": "13px",
                            color: isSelected() ? "#000000" : "#6a6a6a",
                            "white-space": "nowrap",
                            "flex-shrink": "0",
                          }}
                        >
                          {action.keybind}
                        </div>
                      )}
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
