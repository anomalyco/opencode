import { Show, createMemo, createSignal } from "solid-js"
import type { JsonPreviewProps } from "./types"

/**
 * JSON Preview component that displays JSON with syntax highlighting and formatting.
 */
export function JsonPreview(props: JsonPreviewProps) {
  const [viewMode, setViewMode] = createSignal<"formatted" | "raw">("formatted")

  // Parse and format JSON
  const formattedJson = createMemo(() => {
    try {
      const parsed = JSON.parse(props.content)
      return {
        valid: true as const,
        formatted: JSON.stringify(parsed, null, 2),
        parsed,
      }
    } catch (error) {
      return {
        valid: false as const,
        error: error instanceof Error ? error.message : "Invalid JSON",
      }
    }
  })

  // Highlight JSON syntax
  const highlightedJson = createMemo(() => {
    const result = formattedJson()
    if (!result.valid) {
      return props.content
    }

    const content = viewMode() === "formatted" ? result.formatted : props.content

    // Simple JSON syntax highlighting
    return content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Strings
      .replace(/"([^"\\]|\\.)*"/g, '<span class="json-string">$&</span>')
      // Numbers
      .replace(/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="json-number">$1</span>')
      // Booleans and null
      .replace(/\b(true|false|null)\b/g, '<span class="json-keyword">$1</span>')
      // Property names (before the colon)
      .replace(/<span class="json-string">"([^"]+)"<\/span>(\s*):/g, '<span class="json-property">"$1"</span>$2:')
  })

  return (
    <div
      data-component="json-preview"
      class={props.class ?? ""}
    >
      {/* Header with toggle */}
      <div data-slot="json-header">
        <Show
          when={formattedJson().valid}
          fallback={
            <span class="json-error-badge">Invalid JSON</span>
          }
        >
          <div class="json-toggle">
            <button
              type="button"
              classList={{ active: viewMode() === "formatted" }}
              onClick={() => setViewMode("formatted")}
            >
              Formatted
            </button>
            <button
              type="button"
              classList={{ active: viewMode() === "raw" }}
              onClick={() => setViewMode("raw")}
            >
              Raw
            </button>
          </div>
        </Show>
      </div>

      {/* Content */}
      <div data-slot="json-content">
        <pre innerHTML={highlightedJson()} />
      </div>

      <Show when={props.truncated}>
        <div data-slot="truncation-notice">
          Content truncated. Showing first 100KB.
        </div>
      </Show>
    </div>
  )
}
