import type { Component } from "solid-js"
import { For, Show, createSignal, createEffect, onCleanup } from "solid-js"

export interface AutocompleteItem {
  id: string
  label: string
  description?: string
  type?: "file" | "directory" | "command"
}

interface AutocompleteProps {
  items: AutocompleteItem[]
  selectedIndex: number
  onSelect: (item: AutocompleteItem) => void
  onClose: () => void
  position: { x: number; y: number }
  maxHeight?: number
}

export const Autocomplete: Component<AutocompleteProps> = (props) => {
  let containerRef: HTMLDivElement | undefined
  const maxHeight = props.maxHeight || 300

  // Scroll selected item into view
  createEffect(() => {
    if (containerRef) {
      const selectedElement = containerRef.querySelector(`[data-index="${props.selectedIndex}"]`)
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" })
      }
    }
  })

  return (
    <Show when={props.items.length > 0}>
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          left: `${props.position.x}px`,
          top: `${props.position.y}px`,
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          "border-radius": "4px",
          "max-height": `${maxHeight}px`,
          "overflow-y": "auto",
          "min-width": "300px",
          "max-width": "600px",
          "z-index": "1000",
          "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
          "font-size": "14px",
          "line-height": "1.2",
          "box-shadow": "0 4px 12px rgba(0, 0, 0, 0.5)",
        }}
        class="terminal-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <For each={props.items}>
          {(item, index) => {
            const isSelected = () => props.selectedIndex === index()
            const icon = () => {
              if (item.type === "directory") return "📁"
              if (item.type === "file") return "📄"
              if (item.type === "command") return "⚡"
              return ""
            }

            return (
              <div
                data-index={index()}
                onClick={() => props.onSelect(item)}
                style={{
                  padding: "0.6em 1em",
                  background: isSelected() ? "#ff9800" : "transparent",
                  color: isSelected() ? "#000000" : "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "center",
                  gap: "0.5em",
                  transition: "background 0.1s ease",
                }}
              >
                <span style={{ "flex-shrink": "0" }}>{icon()}</span>
                <div style={{ flex: "1", overflow: "hidden" }}>
                  <div
                    style={{
                      "font-weight": isSelected() ? "bold" : "normal",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {item.label}
                  </div>
                  {item.description && (
                    <div
                      style={{
                        "font-size": "12px",
                        color: isSelected() ? "#000000" : "#6a6a6a",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {item.description}
                    </div>
                  )}
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
