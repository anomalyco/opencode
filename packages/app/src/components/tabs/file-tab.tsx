import { Show } from "solid-js"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { CodeViewer } from "@/components/code-viewer"

interface FileTabProps {
  filePath: string
  onSendToChat?: (path: string) => void
  onSendToMainChat?: (path: string) => void
}

export function FileTab(props: FileTabProps) {
  const isMarkdown = () => {
    const path = props.filePath.toLowerCase()
    return path.endsWith(".md") || path.endsWith(".markdown") || path.endsWith(".mdx")
  }

  return (
    <div class="flex flex-col h-full">
      <Show
        when={isMarkdown()}
        fallback={
          <CodeViewer path={props.filePath} onSendToChat={props.onSendToChat} onSendToMainChat={props.onSendToMainChat} />
        }
      >
        <MarkdownViewer path={props.filePath} onSendToChat={props.onSendToChat} onSendToMainChat={props.onSendToMainChat} />
      </Show>
    </div>
  )
}
