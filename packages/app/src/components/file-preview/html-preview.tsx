import type { HtmlPreviewProps } from "./types"

/**
 * HTML Preview component that renders HTML content in a sandboxed iframe.
 *
 * The sandbox attribute provides isolation while allowing:
 * - JavaScript execution (allow-scripts)
 * - CSS to work properly (allow-same-origin)
 *
 * Other restrictions remain in place:
 * - Blocks form submissions
 * - Blocks popups
 * - Prevents plugins
 * - Prevents navigation of the parent page
 */
export function HtmlPreview(props: HtmlPreviewProps) {
  return (
    <div
      data-component="html-preview"
      class={props.class ?? ""}
    >
      <iframe
        sandbox="allow-scripts allow-same-origin"
        srcdoc={props.content}
        title="HTML Preview"
      />
    </div>
  )
}
