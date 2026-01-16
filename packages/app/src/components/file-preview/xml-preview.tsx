import { Show, createMemo, createSignal } from "solid-js"
import type { XmlPreviewProps } from "./types"

/**
 * XML/SVG Preview component that displays XML with syntax highlighting
 * and optional visual rendering for SVG files.
 */
export function XmlPreview(props: XmlPreviewProps) {
  const [viewMode, setViewMode] = createSignal<"code" | "rendered">(
    props.isSvg ? "rendered" : "code"
  )

  // Highlight XML syntax
  const highlightedXml = createMemo(() => {
    return props.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // XML comments
      .replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="xml-comment">$&</span>')
      // Processing instructions
      .replace(/&lt;\?[\s\S]*?\?&gt;/g, '<span class="xml-processing">$&</span>')
      // CDATA sections
      .replace(/&lt;!\[CDATA\[[\s\S]*?\]\]&gt;/g, '<span class="xml-cdata">$&</span>')
      // Tags (opening, closing, self-closing)
      .replace(/&lt;(\/?)([\w:-]+)/g, '&lt;$1<span class="xml-tag">$2</span>')
      // Attribute names
      .replace(/([\w:-]+)(\s*=\s*)/g, '<span class="xml-attr-name">$1</span>$2')
      // Attribute values
      .replace(/=(\s*)("[^"]*"|'[^']*')/g, '=$1<span class="xml-attr-value">$2</span>')
  })

  return (
    <div
      data-component="xml-preview"
      class={props.class ?? ""}
    >
      {/* Header with toggle for SVG files */}
      <Show when={props.isSvg}>
        <div data-slot="xml-header">
          <div class="xml-toggle">
            <button
              type="button"
              classList={{ active: viewMode() === "rendered" }}
              onClick={() => setViewMode("rendered")}
            >
              Preview
            </button>
            <button
              type="button"
              classList={{ active: viewMode() === "code" }}
              onClick={() => setViewMode("code")}
            >
              Source
            </button>
          </div>
        </div>
      </Show>

      {/* Content */}
      <div data-slot="xml-content">
        <Show
          when={props.isSvg && viewMode() === "rendered"}
          fallback={
            <pre innerHTML={highlightedXml()} />
          }
        >
          <div
            data-slot="svg-rendered"
            innerHTML={props.content}
          />
        </Show>
      </div>

      <Show when={props.truncated}>
        <div data-slot="truncation-notice">
          Content truncated. Showing first 100KB.
        </div>
      </Show>
    </div>
  )
}
