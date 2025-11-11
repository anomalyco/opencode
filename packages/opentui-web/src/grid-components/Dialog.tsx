import type { Component, JSX } from "solid-js"
import { createSignal, For, Show, onMount, onCleanup } from "solid-js"

interface DialogProps {
  title: string
  isOpen: boolean
  onClose: () => void
  children: JSX.Element
}

export const Dialog: Component<DialogProps> = (props) => {
  return (
    <Show when={props.isOpen}>
      {/* Overlay */}
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          bottom: "0",
          background: "rgba(0, 0, 0, 0.7)",
          "z-index": "1000",
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
            width: "80%",
            "max-width": "800px",
            "max-height": "80vh",
            display: "flex",
            "flex-direction": "column",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
            "line-height": "1.2",
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
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>{props.title}</span>
            <span style={{ color: "#6a6a6a" }}>esc</span>
          </div>

          {/* Content */}
          <div
            style={{
              flex: "1",
              padding: "1em 1.5em",
              "overflow-y": "auto",
            }}
          >
            {props.children}
          </div>
        </div>
      </div>
    </Show>
  )
}

type DialogVariant = "info" | "error"

interface StyledDialogProps {
  variant?: DialogVariant
  title?: string
  message: string
  actionLabel?: string
  onAction?: () => void
  onClose: () => void
  isOpen: boolean
}

export const StyledDialog: Component<StyledDialogProps> = (props) => {
  const variant = () => props.variant || "info"
  const bgColor = () => (variant() === "info" ? "#61afef" : "#e06c75")
  const title = () => props.title || (variant() === "info" ? "Info" : "Error")

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.isOpen) {
        props.onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown))
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
          background: "rgba(0, 0, 0, 0.8)",
          "z-index": "1000",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        {/* Dialog box */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: bgColor(),
            padding: "2em",
            "border-radius": "4px",
            "min-width": "400px",
            "max-width": "600px",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
            "line-height": "1.5",
            color: "#ffffff",
            display: "flex",
            "flex-direction": "column",
            gap: "1.5em",
          }}
        >
          {/* Title */}
          <div
            style={{
              "font-weight": "bold",
              "font-size": "18px",
            }}
          >
            {title()}
          </div>

          {/* Message */}
          <div>{props.message}</div>

          {/* Action button */}
          {props.actionLabel && props.onAction && (
            <button
              onClick={props.onAction}
              style={{
                background: "#ffffff",
                color: bgColor(),
                border: "none",
                padding: "0.8em 1.5em",
                "border-radius": "3px",
                "font-family": "inherit",
                "font-size": "inherit",
                "font-weight": "bold",
                cursor: "pointer",
                "align-self": "flex-start",
              }}
            >
              {props.actionLabel}
            </button>
          )}
        </div>
      </div>
    </Show>
  )
}

interface SelectListProps {
  items: Array<{ id: string; label: string; group?: string; meta?: string }>
  selectedId: string
  onSelect: (id: string) => void
  searchable?: boolean
}

export const SelectList: Component<SelectListProps> = (props) => {
  const [searchTerm, setSearchTerm] = createSignal("")

  const filteredItems = () => {
    const term = searchTerm().toLowerCase()
    if (!term) return props.items
    return props.items.filter((item) => item.label.toLowerCase().includes(term))
  }

  const groupedItems = () => {
    const items = filteredItems()
    const groups = new Map<string, typeof items>()

    items.forEach((item) => {
      const group = item.group || ""
      if (!groups.has(group)) {
        groups.set(group, [])
      }
      groups.get(group)!.push(item)
    })

    return Array.from(groups.entries())
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1em" }}>
      {/* Search input */}
      {props.searchable && (
        <div style={{ position: "relative" }}>
          <input
            type="text"
            placeholder="Enter search term"
            value={searchTerm()}
            onInput={(e) => setSearchTerm(e.currentTarget.value)}
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
      )}

      {/* List */}
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5em" }}>
        <For each={groupedItems()}>
          {([groupName, items]) => (
            <>
              {groupName && (
                <div style={{ color: "#d19a66", "font-weight": "bold", "margin-top": "0.5em" }}>{groupName}</div>
              )}
              <For each={items}>
                {(item) => (
                  <div
                    onClick={() => props.onSelect(item.id)}
                    style={{
                      padding: "0.5em 1em",
                      background: props.selectedId === item.id ? "#d19a66" : "transparent",
                      color: props.selectedId === item.id ? "#000000" : "#ffffff",
                      cursor: "pointer",
                      "border-radius": "2px",
                      display: "flex",
                      "justify-content": "space-between",
                      "align-items": "center",
                    }}
                  >
                    <span>{item.label}</span>
                    {item.meta && <span style={{ color: "#6a6a6a" }}>{item.meta}</span>}
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  )
}
