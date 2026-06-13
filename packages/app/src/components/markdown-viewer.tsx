import { createSignal, createEffect, Show, For } from "solid-js"
import { Icon } from "@cedric/ui/icon"
import { IconButton } from "@cedric/ui/icon-button"
import { useFile } from "@/context/file"
import { ScrollView } from "@cedric/ui/scroll-view"

interface MarkdownViewerProps {
  path?: string
  onSendToChat?: (path: string) => void
  onSendToMainChat?: (path: string) => void
}

interface TocItem {
  level: number
  text: string
  id: string
}

export function MarkdownViewer(props: MarkdownViewerProps) {
  const [content, setContent] = createSignal("")
  const [toc, setToc] = createSignal<TocItem[]>([])
  const [showToc, setShowToc] = createSignal(true)
  const file = useFile()

  createEffect(() => {
    const path = props.path
    if (!path) return

    // Load file content
    void file.load(path).then(() => {
      const state = file.get(path)
      const text = state?.content?.content || ""
      setContent(text)

      // Parse TOC from markdown headers
      const headers: TocItem[] = []
      const lines = text.split("\n")
      lines.forEach((line: string, index: number) => {
        const match = line.match(/^(#{1,6})\s+(.+)$/)
        if (match) {
          headers.push({
            level: match[1].length,
            text: match[2].trim(),
            id: `heading-${index}`,
          })
        }
      })
      setToc(headers)
    })
  })

  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
  }

  const sendToChat = () => {
    if (!props.path) return
    props.onSendToChat?.(props.path)
  }

  const sendToMainChat = () => {
    if (!props.path) return
    props.onSendToMainChat?.(props.path)
  }

  return (
    <div class="flex h-full bg-background-base">
      {/* TOC Sidebar */}
      <Show when={showToc() && toc().length > 0}>
        <div class="w-64 border-r border-border-weaker-base bg-background-stronger flex flex-col shrink-0">
          <div class="px-3 py-2 border-b border-border-weaker-base shrink-0">
            <div class="text-14-semibold text-text-base">Table of Contents</div>
          </div>
          <div class="flex-1 overflow-y-auto p-2">
            <For each={toc()}>
              {(item) => (
                <button
                  class="block w-full text-left px-2 py-1 text-13-regular rounded-md hover:bg-background-base transition-colors"
                  classList={{
                    "text-text-base": item.level === 1,
                    "text-text-weak": item.level > 1,
                    "pl-4": item.level === 2,
                    "pl-6": item.level === 3,
                    "pl-8": item.level >= 4,
                  }}
                  onClick={() => scrollToHeading(item.id)}
                >
                  {item.text}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Content Area */}
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-border-weaker-base shrink-0">
          <button
            class="text-12-regular text-text-weak hover:text-text-base px-2 py-1 rounded-md hover:bg-background-stronger transition-colors"
            onClick={() => setShowToc(!showToc())}
          >
            {showToc() ? "Hide TOC" : "Show TOC"}
          </button>
          <Show when={props.path}>
            <div class="text-12-regular text-text-weak truncate">
              {props.path}
            </div>
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <IconButton
              icon="comment"
              variant="ghost"
              class="w-7 h-7"
              title="Send file to Side Chat"
              aria-label="Send file to Side Chat"
              disabled={!props.path}
              onClick={sendToChat}
            />
            <IconButton
              icon="prompt"
              variant="ghost"
              class="w-7 h-7"
              title="Send file to Main Chat"
              aria-label="Send file to Main Chat"
              disabled={!props.path}
              onClick={sendToMainChat}
            />
          </div>
        </div>

        <ScrollView class="flex-1">
          <div class="p-6 max-w-3xl">
            <Show
              when={content()}
              fallback={
                <div class="flex flex-col items-center justify-center h-full gap-4 py-12">
                  <div class="w-16 h-16 rounded-2xl bg-background-stronger flex items-center justify-center">
                    <Icon name="open-file" class="w-8 h-8 text-text-weak" />
                  </div>
                  <div class="space-y-1 text-center">
                    <div class="text-18-semibold text-text-base">No Markdown File Open</div>
                    <div class="text-14-regular text-text-weak max-w-sm">
                      Open a .md file from the file tree to view it with a table of contents and rich formatting.
                    </div>
                  </div>
                </div>
              }
            >
              <MarkdownContent content={content()} toc={toc()} />
            </Show>
          </div>
        </ScrollView>
      </div>
    </div>
  )
}

function MarkdownContent(props: { content: string; toc: TocItem[] }) {
  const [html, setHtml] = createSignal("")
  const marked = useMarked()

  createEffect(() => {
    const text = props.content
    if (!text) return

    // Add IDs to headers for TOC linking
    let processedText = text
    const lines = text.split("\n")
    let headingIndex = 0

    processedText = lines.map((line) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        const id = props.toc[headingIndex]?.id || `heading-${headingIndex}`
        headingIndex++
        return `${match[1]} ${match[2]} {#${id}}`
      }
      return line
    }).join("\n")

    // Parse markdown to HTML
    void marked.parse(processedText).then((parsedHtml) => {
      setHtml(parsedHtml)
    })
  })

  return (
    <div
      class="prose prose-sm max-w-none dark:prose-invert"
      innerHTML={html()}
    />
  )
}

// Hook to access marked parser
function useMarked() {
  return {
    parse: async (text: string): Promise<string> => {
      // Use the desktop's markdown parser if available
      if (window.api?.parseMarkdownCommand) {
        return window.api.parseMarkdownCommand(text)
      }

      // Simple fallback parser
      return simpleMarkdownParser(text)
    },
  }
}

function simpleMarkdownParser(text: string): string {
  let html = text
    // Headers
    .replace(/^#{6}\s+(.+)$/gm, '<h6 id="$1" class="text-14-semibold text-text-base mt-4 mb-2">$1</h6>')
    .replace(/^#{5}\s+(.+)$/gm, '<h5 id="$1" class="text-15-semibold text-text-base mt-4 mb-2">$1</h5>')
    .replace(/^#{4}\s+(.+)$/gm, '<h4 id="$1" class="text-16-semibold text-text-base mt-4 mb-2">$1</h4>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3 id="$1" class="text-18-semibold text-text-base mt-6 mb-3">$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2 id="$1" class="text-20-semibold text-text-base mt-6 mb-3">$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1 id="$1" class="text-24-bold text-text-base mt-8 mb-4">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
    // Code inline
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-background-stronger rounded text-13-regular text-text-base font-mono">$1</code>')
    // Code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-background-stronger rounded-lg p-4 my-4 overflow-x-auto"><code class="text-13-regular text-text-base font-mono block">$2</code></pre>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-icon-info-active hover:underline">$1</a>')
    // Lists
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li class="ml-4 text-14-regular text-text-base">$1</li>')
    // Blockquotes
    .replace(/^>\s+(.+)$/gm, '<blockquote class="border-l-4 border-border-weaker-base pl-4 my-4 text-14-regular text-text-weak italic">$1</blockquote>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr class="border-border-weaker-base my-6"/>')
    // Tables
    .replace(/\|(.+)\|/g, '<td class="border border-border-weaker-base px-3 py-2 text-14-regular">$1</td>')
    // Line breaks - only for lines that aren't already wrapped
    .replace(/([^>])\n/g, '$1<br/>')

  // Wrap consecutive list items in ul
  html = html.replace(/(<li[^>]*>.*<\/li>\s*)+/g, '<ul class="my-4 space-y-1">$&</ul>')

  return html
}
