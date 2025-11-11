import type { Component } from "solid-js"
import { createSignal, For, Show, createEffect } from "solid-js"

export interface Model {
  id: string
  name: string
  provider: string
  description?: string
}

interface ModelPickerProps {
  isOpen: boolean
  models: Model[]
  currentModelId?: string
  onSelect: (modelId: string) => void
  onClose: () => void
}

interface GroupedModels {
  provider: string
  models: Model[]
}

const groupModelsByProvider = (models: Model[]): GroupedModels[] => {
  const groups = new Map<string, Model[]>()

  models.forEach((model) => {
    if (!groups.has(model.provider)) {
      groups.set(model.provider, [])
    }
    groups.get(model.provider)!.push(model)
  })

  return Array.from(groups.entries()).map(([provider, models]) => ({
    provider,
    models,
  }))
}

export const ModelPicker: Component<ModelPickerProps> = (props) => {
  const [searchTerm, setSearchTerm] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const filteredModels = () => {
    const term = searchTerm().toLowerCase()
    if (!term) return props.models

    return props.models.filter(
      (model) =>
        model.name.toLowerCase().includes(term) ||
        model.provider.toLowerCase().includes(term) ||
        model.description?.toLowerCase().includes(term),
    )
  }

  const groupedModels = () => {
    return groupModelsByProvider(filteredModels())
  }

  // Flatten models for keyboard navigation
  const flatModels = () => {
    return filteredModels()
  }

  const handleSelect = (modelId: string) => {
    props.onSelect(modelId)
    props.onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const allModels = flatModels()

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allModels.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const model = allModels[selectedIndex()]
      if (model) {
        handleSelect(model.id)
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

  // Track current index for models in flat list
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
        {/* Model picker box */}
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
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>Switch Model</span>
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
              placeholder="Search models..."
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

          {/* Model list */}
          <div
            style={{
              "max-height": "500px",
              "overflow-y": "auto",
              padding: "1em 0",
            }}
            class="terminal-scrollbar"
          >
            <Show
              when={flatModels().length > 0}
              fallback={
                <div
                  style={{
                    padding: "2em",
                    "text-align": "center",
                    color: "#6a6a6a",
                  }}
                >
                  No models found
                </div>
              }
            >
              <For each={groupedModels()}>
                {(group) => {
                  const groupStartIndex = currentIndex
                  currentIndex += group.models.length
                  return (
                    <div style={{ "margin-bottom": "0.25em" }}>
                      {/* Provider header */}
                      <div
                        style={{
                          padding: "0.4em 1.5em 0.2em 1.5em",
                          color: "#ff9800",
                          "font-weight": "bold",
                        }}
                      >
                        {group.provider}
                      </div>

                      {/* Group models */}
                      <For each={group.models}>
                        {(model, index) => {
                          const modelIndex = groupStartIndex + index()
                          const isSelected = () => selectedIndex() === modelIndex
                          const isCurrent = () => props.currentModelId === model.id
                          return (
                            <div
                              onClick={() => handleSelect(model.id)}
                              style={{
                                padding: "0.5em 1.5em",
                                background: isCurrent() || isSelected() ? "#ff9800" : "transparent",
                                color: isCurrent() || isSelected() ? "#000000" : "#ffffff",
                                cursor: "pointer",
                                display: "flex",
                                "flex-direction": "column",
                                transition: "background 0.1s ease",
                              }}
                              onMouseEnter={() => setSelectedIndex(modelIndex)}
                            >
                              <span
                                style={{
                                  "font-weight": isCurrent() || isSelected() ? "bold" : "normal",
                                }}
                              >
                                {model.name}
                              </span>
                              {model.description && (
                                <span
                                  style={{
                                    "font-size": "14px",
                                    color: isCurrent() || isSelected() ? "#000000" : "#6a6a6a",
                                    "margin-top": "0.2em",
                                  }}
                                >
                                  {model.description}
                                </span>
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

          {/* Footer with keyboard hints */}
          <div
            style={{
              padding: "0.75em 1.5em",
              "border-top": "1px solid #2a2a2a",
              color: "#6a6a6a",
              "font-size": "14px",
            }}
          >
            <span>↑↓ navigate · enter select · esc close</span>
          </div>
        </div>
      </div>
    </Show>
  )
}
