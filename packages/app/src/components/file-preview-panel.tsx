import { Show, createSignal, createEffect, on, createMemo, onCleanup } from "solid-js"
import { useLayout } from "@/context/layout"
import { useLocal, type LocalFile } from "@/context/local"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Markdown } from "@opencode-ai/ui/markdown"
import { getPreviewType, validateContent } from "./file-preview"
import { TextPreview } from "./file-preview/text-preview"
import { HtmlPreview } from "./file-preview/html-preview"
import type { PreviewError } from "./file-preview/types"
import "./file-preview/file-preview.css"

/**
 * Standalone file preview panel for the main content area.
 * Displays file content in a resizable panel next to the chat.
 */
export function FilePreviewPanel() {
  const layout = useLayout()
  const local = useLocal()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<PreviewError | null>(null)
  const [showSizeWarning, setShowSizeWarning] = createSignal(false)
  const [file, setFile] = createSignal<LocalFile | null>(null)

  // Get the file path from layout context
  const filePath = createMemo(() => layout.filePreview.filePath())

  // Get the preview type based on file extension
  const previewType = createMemo(() => {
    const f = file()
    if (!f) return null
    return getPreviewType(f.name)
  })

  // Load file when path changes
  createEffect(
    on(
      filePath,
      async (path) => {
        if (!path) {
          setFile(null)
          setError(null)
          setShowSizeWarning(false)
          return
        }

        setError(null)
        setShowSizeWarning(false)
        setLoading(true)

        try {
          // Get node from local file system
          const node = await local.file.node(path)
          if (node) {
            setFile(node as LocalFile)
            // Load content if not already loaded
            if (!node.content) {
              await local.file.load(path)
              // Re-fetch after load
              const updatedNode = await local.file.node(path)
              if (updatedNode) {
                setFile(updatedNode as LocalFile)
              }
            }
          } else {
            setError({
              type: "not_found",
              message: "File not found.",
            })
          }
        } catch (e) {
          setError({
            type: "not_found",
            message: "Failed to load file. The file may have been moved or deleted.",
          })
        } finally {
          setLoading(false)
        }
      },
      { defer: false }
    )
  )

  // Validate and prepare content
  const preparedContent = createMemo(() => {
    const f = file()
    if (!f?.content?.content) return null

    const result = validateContent(f.content.content)
    if (!result.valid) {
      setError(result.error)
      return null
    }

    setShowSizeWarning(result.showWarning)
    return {
      content: result.content,
      truncated: result.truncated,
    }
  })

  // Check if file is empty
  const isEmpty = createMemo(() => {
    const f = file()
    return f?.content?.content === ""
  })

  // Handle ESC key to close
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      layout.filePreview.close()
    }
  }

  createEffect(() => {
    if (layout.filePreview.opened()) {
      document.addEventListener("keydown", handleKeyDown)
    }
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown)
    })
  })

  return (
    <div
      data-component="file-preview-panel"
      class="flex flex-col h-full bg-background-base flex-1 min-w-0 border-l border-border-weak-base"
    >
        {/* Header */}
        <div
          data-slot="preview-header"
          class="h-12 px-3 flex items-center justify-between shrink-0 border-b border-border-weak-base"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-12-medium text-text-weak truncate">
              {file()?.name ?? "Preview"}
            </span>
            <Show when={showSizeWarning()}>
              <span class="text-11-regular text-text-warning">
                (Large file)
              </span>
            </Show>
          </div>
          <IconButton
            icon="close"
            size="normal"
            variant="ghost"
            onClick={() => layout.filePreview.close()}
            aria-label="Close preview"
          />
        </div>

        {/* Content */}
        <div
          data-slot="preview-content"
          class="flex-1 overflow-auto min-h-0"
        >
          {/* Loading state */}
          <Show when={loading()}>
            <div class="flex items-center justify-center h-full p-4">
              <div class="flex items-center gap-2 text-text-muted">
                <svg
                  class="w-4 h-4 animate-spin"
                  viewBox="0 0 16 16"
                  fill="none"
                >
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
                <span class="text-sm">Loading...</span>
              </div>
            </div>
          </Show>

          {/* Error state */}
          <Show when={!loading() && error()}>
            <div class="flex flex-col items-center justify-center h-full p-4 text-center">
              <svg
                class="w-8 h-8 mb-2 text-text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span class="text-sm text-text-muted">{error()?.message}</span>
            </div>
          </Show>

          {/* Empty file state */}
          <Show when={!loading() && !error() && isEmpty()}>
            <div class="flex items-center justify-center h-full p-4">
              <span class="text-sm text-text-muted">This file is empty</span>
            </div>
          </Show>

          {/* Content preview */}
          <Show when={!loading() && !error() && !isEmpty() && preparedContent()}>
            {/* Text preview */}
            <Show when={previewType() === "text"}>
              <TextPreview
                content={preparedContent()!.content}
                truncated={preparedContent()!.truncated}
              />
            </Show>

            {/* Markdown preview */}
            <Show when={previewType() === "markdown"}>
              <div data-slot="markdown-wrapper" class="p-4">
                <Markdown
                  text={preparedContent()!.content}
                  cacheKey={filePath() ?? undefined}
                />
                <Show when={preparedContent()!.truncated}>
                  <div class="mt-4 pt-4 border-t border-border-weak-base text-center text-sm text-text-muted">
                    Content truncated. Showing first 100KB.
                  </div>
                </Show>
              </div>
            </Show>

            {/* HTML preview */}
            <Show when={previewType() === "html"}>
              <HtmlPreview content={preparedContent()!.content} />
              <Show when={preparedContent()!.truncated}>
                <div class="p-2 border-t border-border-weak-base text-center text-sm text-text-muted">
                  Content truncated. Showing first 100KB.
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
  )
}
