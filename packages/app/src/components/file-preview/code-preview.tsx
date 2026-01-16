import { Show, createEffect, on, createSignal } from "solid-js"
import { createHighlighter, bundledLanguages, type BundledLanguage, type Highlighter } from "shiki"
import type { CodePreviewProps } from "./types"

// Shared highlighter instance
let highlighterPromise: Promise<Highlighter> | null = null

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [],
    })
  }
  return highlighterPromise
}

/**
 * Code Preview component that renders code with syntax highlighting.
 * Uses shiki for syntax highlighting.
 */
export function CodePreview(props: CodePreviewProps) {
  const [highlightedHtml, setHighlightedHtml] = createSignal<string>("")
  const [isLoading, setIsLoading] = createSignal(true)

  // Highlight code when content or language changes
  createEffect(
    on(
      () => [props.content, props.language] as const,
      async ([content, language]) => {
        setIsLoading(true)
        try {
          const highlighter = await getHighlighter()

          let lang = language
          // Validate language is supported
          if (!(lang in bundledLanguages)) {
            lang = "plaintext"
          }

          // Load language if not already loaded
          if (!highlighter.getLoadedLanguages().includes(lang)) {
            await highlighter.loadLanguage(lang as BundledLanguage)
          }

          const html = highlighter.codeToHtml(content, {
            lang: lang || "plaintext",
            theme: "github-dark",
          })

          setHighlightedHtml(html)
        } catch (error) {
          console.error("[CodePreview] Highlighting error:", error)
          // Fallback to plain text
          setHighlightedHtml(`<pre><code>${escapeHtml(content)}</code></pre>`)
        } finally {
          setIsLoading(false)
        }
      },
      { defer: false }
    )
  )

  return (
    <div
      data-component="code-preview"
      class={props.class ?? ""}
    >
      <Show
        when={!isLoading()}
        fallback={
          <div class="code-preview-loading">
            <pre><code>{props.content}</code></pre>
          </div>
        }
      >
        <div
          class="code-preview-content"
          innerHTML={highlightedHtml()}
        />
      </Show>
      <Show when={props.truncated}>
        <div data-slot="truncation-notice">
          Content truncated. Showing first 100KB.
        </div>
      </Show>
    </div>
  )
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (char) => map[char])
}
