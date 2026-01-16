import { Show, createSignal, createEffect, on, onCleanup } from "solid-js"
import { renderAsync } from "docx-preview"
import type { DocxPreviewProps } from "./types"

/**
 * DOCX Preview component that renders Word documents using docx-preview library.
 */
export function DocxPreview(props: DocxPreviewProps) {
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  let containerRef: HTMLDivElement | undefined

  // Render DOCX when content changes
  createEffect(
    on(
      () => props.content,
      async (content) => {
        if (!content || !containerRef) return

        setLoading(true)
        setError(null)

        try {
          // Convert base64 to ArrayBuffer
          const binaryString = atob(content)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          const arrayBuffer = bytes.buffer

          // Clear previous content
          containerRef.innerHTML = ""

          // Render the DOCX
          await renderAsync(arrayBuffer, containerRef, undefined, {
            className: "docx-preview-document",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
          })
        } catch (e) {
          console.error("[DocxPreview] Render error:", e)
          setError("Failed to render document. The file may be corrupted or in an unsupported format.")
        } finally {
          setLoading(false)
        }
      },
      { defer: false }
    )
  )

  return (
    <div
      data-component="docx-preview"
      class={props.class ?? ""}
    >
      {/* Loading state */}
      <Show when={loading()}>
        <div data-slot="docx-loading">
          <svg class="w-5 h-5 animate-spin" viewBox="0 0 16 16" fill="none">
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              stroke-width="2"
              stroke-dasharray="28"
              stroke-dashoffset="7"
            />
          </svg>
          <span>Loading document...</span>
        </div>
      </Show>

      {/* Error state */}
      <Show when={error()}>
        <div data-slot="docx-error">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="12" y1="9" x2="12.01" y2="9" />
          </svg>
          <span>{error()}</span>
        </div>
      </Show>

      {/* Document container */}
      <div
        ref={containerRef}
        data-slot="docx-container"
        classList={{ hidden: loading() || !!error() }}
      />
    </div>
  )
}
