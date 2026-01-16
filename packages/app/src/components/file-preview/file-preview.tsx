import { Show, createSignal, createEffect, on, createMemo } from "solid-js"
import type { LocalFile } from "@/context/local"
import { useLocal } from "@/context/local"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Markdown } from "@opencode-ai/ui/markdown"
import { getPreviewType, validateContent, formatFileSize, getLanguageFromFilename, isSvgFile, getCsvDelimiter } from "./utils"
import { TextPreview } from "./text-preview"
import { HtmlPreview } from "./html-preview"
import { CodePreview } from "./code-preview"
import { ImagePreview } from "./image-preview"
import { JsonPreview } from "./json-preview"
import { XmlPreview } from "./xml-preview"
import { CsvPreview } from "./csv-preview"
import { PdfPreview } from "./pdf-preview"
import type { FilePreviewProps, PreviewError } from "./types"
import { SIZE_LIMITS } from "./types"
import "./file-preview.css"

export function FilePreview(props: FilePreviewProps) {
  const local = useLocal()
  const [expanded, setExpanded] = createSignal(true)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<PreviewError | null>(null)
  const [showSizeWarning, setShowSizeWarning] = createSignal(false)

  // Get the preview type based on file extension
  const previewType = createMemo(() => {
    const file = props.file
    if (!file) return null
    return getPreviewType(file.name)
  })

  // Load file content when file changes
  createEffect(
    on(
      () => props.file?.path,
      async (path) => {
        if (!path || !props.file) {
          setError(null)
          setShowSizeWarning(false)
          return
        }

        const type = previewType()
        if (!type) {
          setError({
            type: "unsupported_type",
            message: "Preview not available for this file type.",
          })
          return
        }

        // Note: File size check happens after content loads via validateContent

        setError(null)
        setShowSizeWarning(false)

        // Check if content is already loaded
        if (!props.file.content) {
          setLoading(true)
          try {
            await local.file.load(path)
          } catch (e) {
            setError({
              type: "not_found",
              message: "Failed to load file. The file may have been moved or deleted.",
            })
          } finally {
            setLoading(false)
          }
        }
      },
      { defer: false }
    )
  )

  // Validate and prepare content
  const preparedContent = createMemo(() => {
    const file = props.file
    if (!file?.content?.content) return null

    const result = validateContent(file.content.content)
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
    const file = props.file
    return file?.content?.content === ""
  })

  return (
    <Show when={props.file}>
      <div
        data-component="file-preview"
        class={`flex flex-col border-t border-border-weak-base ${props.class ?? ""}`}
      >
        {/* Header */}
        <div
          data-slot="preview-header"
          class="h-10 px-3 flex items-center justify-between shrink-0 bg-background-weak"
        >
          <div class="flex items-center gap-2 min-w-0">
            <button
              class="text-text-muted hover:text-text-base transition-colors"
              onClick={() => setExpanded(!expanded())}
              aria-label={expanded() ? "Collapse preview" : "Expand preview"}
            >
              <svg
                class={`w-4 h-4 transition-transform ${expanded() ? "rotate-90" : ""}`}
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M6 4l4 4-4 4V4z" />
              </svg>
            </button>
            <span class="text-12-medium text-text-weak truncate">
              {props.file?.name}
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
            onClick={() => props.onClose?.()}
            aria-label="Close preview"
          />
        </div>

        {/* Content */}
        <Show when={expanded()}>
          <div
            data-slot="preview-content"
            class="flex-1 overflow-auto min-h-[200px] max-h-[400px]"
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
                    cacheKey={props.file?.path}
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

              {/* Code preview */}
              <Show when={previewType() === "code"}>
                <CodePreview
                  content={preparedContent()!.content}
                  language={getLanguageFromFilename(props.file?.name ?? "")}
                  truncated={preparedContent()!.truncated}
                />
              </Show>

              {/* JSON preview */}
              <Show when={previewType() === "json"}>
                <JsonPreview
                  content={preparedContent()!.content}
                  truncated={preparedContent()!.truncated}
                />
              </Show>

              {/* XML preview */}
              <Show when={previewType() === "xml"}>
                <XmlPreview
                  content={preparedContent()!.content}
                  isSvg={isSvgFile(props.file?.name ?? "")}
                  truncated={preparedContent()!.truncated}
                />
              </Show>

              {/* CSV/TSV preview */}
              <Show when={previewType() === "csv"}>
                <CsvPreview
                  content={preparedContent()!.content}
                  delimiter={getCsvDelimiter(props.file?.name ?? "")}
                  truncated={preparedContent()!.truncated}
                />
              </Show>

              {/* PDF preview */}
              <Show when={previewType() === "pdf"}>
                <PdfPreview
                  content={props.file?.content?.content ?? ""}
                />
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}
