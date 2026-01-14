import type { HtmlPreviewProps } from "./types"

/**
 * HTML Preview component that renders HTML content in a sandboxed iframe.
 *
 * Security is provided by the iframe's sandbox attribute which:
 * - Disables JavaScript execution (no allow-scripts)
 * - Blocks form submissions
 * - Blocks popups
 * - Prevents plugins
 *
 * The allow-same-origin flag is needed for CSS to work properly.
 */
export function HtmlPreview(props: HtmlPreviewProps) {
  // Basic script tag removal as an extra safety measure
  // The sandbox attribute already blocks script execution
  const sanitizeBasic = (html: string): string => {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/on\w+\s*=\s*[^\s>]+/gi, "")
  }

  return (
    <div
      data-component="html-preview"
      class={props.class ?? ""}
    >
      <iframe
        sandbox="allow-same-origin"
        srcdoc={sanitizeBasic(props.content)}
        title="HTML Preview"
      />
    </div>
  )
}
