import type { Component } from "solid-js"
import { createSignal, Show, For } from "solid-js"
import { useSync } from "../context/sync"

interface BottomBarProps {
  sessionID?: string
  onModelChange?: (providerID: string, modelID: string) => void
}

export const BottomBar: Component<BottomBarProps> = (props) => {
  const sync = useSync()
  const [showModelSelector, setShowModelSelector] = createSignal(false)
  const [selectedProvider, setSelectedProvider] = createSignal<string>()
  const [selectedModel, setSelectedModel] = createSignal<string>()

  const currentModelDisplay = () => {
    if (!selectedProvider() || !selectedModel()) {
      return "Claude Sonnet 4.5 (latest)"
    }
    const provider = sync.data.provider.find((p) => p.id === selectedProvider())
    const model = provider?.models[selectedModel()!]
    return model?.name || "Select Model"
  }

  const providers = () => sync.data.provider

  return (
    <div
      style={{
        height: "36px",
        background: "#1e1e1e",
        "border-top": "1px solid #3e3e3e",
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "0 1rem",
        "font-size": "0.8rem",
        position: "relative",
      }}
    >
      {/* Left: Build info */}
      <div style={{ display: "flex", "align-items": "center", gap: "1rem", color: "#858585", "font-size": "0.75rem" }}>
        <span>opencode v0.0.0-dev</span>
        <span>~/Documents/GitHub/flows/opencode-stt</span>
      </div>

      {/* Right: Model selector and actions */}
      <div style={{ display: "flex", "align-items": "center", gap: "1rem" }}>
        <button
          onClick={() => setShowModelSelector(!showModelSelector())}
          style={{
            background: "transparent",
            border: "1px solid #3e3e3e",
            "border-radius": "2px",
            padding: "0.25rem 0.75rem",
            color: "#4ec9b0",
            cursor: "pointer",
            "font-family": '"Berkeley Mono", monospace',
            "font-size": "0.75rem",
            display: "flex",
            "align-items": "center",
            gap: "0.5rem",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#4ec9b0"
            e.currentTarget.style.background = "#1a2a2a"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#3e3e3e"
            e.currentTarget.style.background = "transparent"
          }}
        >
          <span>Anthropic</span>
          <span style={{ color: "#d4d4d4" }}>{currentModelDisplay()}</span>
        </button>

        <div
          style={{ display: "flex", "align-items": "center", gap: "0.5rem", color: "#858585", "font-size": "0.75rem" }}
        >
          <span>tab</span>
          <span
            style={{
              background: "#2e2e2e",
              padding: "0.2rem 0.5rem",
              "border-radius": "2px",
              "font-weight": "500",
              "font-size": "0.7rem",
            }}
          >
            BUILD
          </span>
        </div>

        <span style={{ color: "#858585", "font-size": "0.75rem" }}>esc interrupt</span>
      </div>

      {/* Model Selector Dropdown */}
      <Show when={showModelSelector()}>
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            right: "1rem",
            "margin-bottom": "0.5rem",
            width: "400px",
            background: "#252525",
            border: "1px solid #3e3e3e",
            "border-radius": "4px",
            "box-shadow": "0 -4px 12px rgba(0, 0, 0, 0.5)",
            "z-index": 1000,
            "max-height": "400px",
            "overflow-y": "auto",
          }}
        >
          <div style={{ padding: "0.75rem 1rem", "border-bottom": "1px solid #3e3e3e" }}>
            <div style={{ "font-weight": "bold", color: "#d4d4d4", "font-size": "0.9rem" }}>Select Model</div>
          </div>
          <For each={providers()}>
            {(provider) => (
              <div>
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    "border-bottom": "1px solid #2e2e2e",
                    background: "#2a2a2a",
                  }}
                >
                  <div style={{ color: "#4ec9b0", "font-weight": "600", "font-size": "0.85rem" }}>{provider.name}</div>
                </div>
                <For each={Object.entries(provider.models)}>
                  {([modelID, model]) => (
                    <button
                      onClick={() => {
                        setSelectedProvider(provider.id)
                        setSelectedModel(modelID)
                        props.onModelChange?.(provider.id, modelID)
                        setShowModelSelector(false)
                      }}
                      style={{
                        width: "100%",
                        padding: "0.75rem 1rem",
                        background: "transparent",
                        border: "none",
                        "border-bottom": "1px solid #2e2e2e",
                        color: "#d4d4d4",
                        "text-align": "left",
                        cursor: "pointer",
                        "font-family": "inherit",
                        "font-size": "0.85rem",
                        display: "flex",
                        "justify-content": "space-between",
                        "align-items": "center",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#2e2e2e"
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent"
                      }}
                    >
                      <span>{model.name}</span>
                      <Show when={model.limit?.context}>
                        <span style={{ color: "#858585", "font-size": "0.75rem" }}>
                          {(model.limit!.context / 1000).toFixed(0)}K context
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
