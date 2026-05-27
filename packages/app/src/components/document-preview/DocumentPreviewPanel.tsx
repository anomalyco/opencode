import { Show, type Accessor } from "solid-js"
import { IconButton } from "@yunpat/ui/icon-button"
import { useLanguage } from "@/context/language"

export type DocumentFile = {
  name: string
  path: string
  type: "pdf" | "docx" | "text" | "markdown" | "html"
  url?: string
  content?: string
}

type DocumentPreviewPanelProps = {
  file: DocumentFile | undefined
  onClose: () => void
}

export function DocumentPreviewPanel(props: DocumentPreviewPanelProps) {
  const language = useLanguage()

  return (
    <div class="h-full flex flex-col bg-background-base">
      {/* Header */}
      <Show when={props.file}>
        {(file: Accessor<NonNullable<DocumentFile>>) => (
          <div class="shrink-0 flex items-center gap-2 px-3 h-10 border-b border-border-weaker-base">
            <div class="flex-1 min-w-0 text-14-medium text-text-strong truncate">
              {file().name}
            </div>
            <IconButton
              icon="close-small"
              variant="ghost"
              class="h-6 w-6 shrink-0"
              onClick={props.onClose}
              aria-label={language.t("common.close")}
            />
          </div>
        )}
      </Show>

      {/* Content */}
      <Show
        when={props.file}
        fallback={
          <div class="flex-1 flex items-center justify-center">
            <div class="text-14-regular text-text-weak text-center max-w-56">
              {language.t("session.files.selectToOpen")}
            </div>
          </div>
        }
      >
        {(file: Accessor<NonNullable<DocumentFile>>) => (
          <div class="flex-1 min-h-0 overflow-auto">
            <DocumentRenderer file={file()} />
          </div>
        )}
      </Show>
    </div>
  )
}

function DocumentRenderer(props: { file: DocumentFile }) {
  if (props.file.type === "pdf") {
    return <PdfContent url={props.file.url ?? ""} />
  }
  if (props.file.type === "html" || props.file.type === "markdown") {
    return <HtmlContent content={props.file.content ?? ""} />
  }
  return <TextContent content={props.file.content ?? ""} />
}

function PdfContent(props: { url: string }) {
  return (
    <div class="h-full w-full">
      <iframe
        src={props.url}
        class="w-full h-full border-0"
        title="PDF Preview"
      />
    </div>
  )
}

function HtmlContent(props: { content: string }) {
  return (
    <div
      class="p-4 prose prose-sm max-w-none dark:prose-invert"
      innerHTML={props.content}
    />
  )
}

function TextContent(props: { content: string }) {
  return (
    <pre class="p-4 text-13-regular text-text-base whitespace-pre-wrap break-words font-mono leading-relaxed">
      {props.content}
    </pre>
  )
}
