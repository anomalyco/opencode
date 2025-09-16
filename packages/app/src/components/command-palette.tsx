import { createSignal, createEffect, Show, For, createMemo, createResource } from "solid-js"
import { Dialog } from "@kobalte/core/dialog"
import { FileIcon, Icon, IconButton } from "@/ui"
import { useLocal, useSDK } from "@/context"
import type { LocalFile } from "@/context/local"
import type { FileNode } from "@opencode-ai/sdk"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CommandPalette(props: CommandPaletteProps) {
  const local = useLocal()
  const sdk = useSDK()

  const [search, setSearch] = createSignal("")
  const [debouncedSearch, setDebouncedSearch] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  let inputRef: HTMLInputElement | undefined
  let searchTimer: number | undefined

  const [searchResults] = createResource(
    debouncedSearch,
    async (query) => {
      const trimmed = query.trim()
      if (trimmed.length < 2) return []

      const res = await sdk.find.files({ query: { query: trimmed } })
      const files: FileNode[] = (res.data ?? []).map((path: string) => {
        const name = path.split("/").pop() || path
        return {
          name,
          path,
          absolute: path,
          type: "file" as const,
          ignored: false,
        }
      })

      return files
    },
    { initialValue: [] },
  )

  const handleSearchInput = (value: string) => {
    setSearch(value)
    setSelectedIndex(0)

    if (searchTimer) {
      clearTimeout(searchTimer)
    }

    searchTimer = setTimeout(() => {
      setDebouncedSearch(value)
    }, 300) as unknown as number
  }

  const displayFiles = createMemo(() => {
    const results = searchResults() ?? []
    return results.map((node) => {
      const localNode = local.file.node(node.path)
      return localNode || node
    })
  })

  createEffect(() => {
    if (props.open && inputRef) {
      setTimeout(() => {
        inputRef?.focus()
        setSearch("")
        setDebouncedSearch("")
        setSelectedIndex(0)
      }, 0)
    } else if (!props.open) {
      if (searchTimer) {
        clearTimeout(searchTimer)
        searchTimer = undefined
      }
    }
  })

  const handleSelect = (file: FileNode | LocalFile) => {
    local.file.open(file.path)
    props.onOpenChange(false)
    setSearch("")
    setDebouncedSearch("")
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const files = displayFiles()

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, files.length - 1))
      return
    }

    if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      const selected = files[selectedIndex()]
      if (selected) handleSelect(selected)
      return
    }

    if (e.key === "Escape") {
      e.preventDefault()
      props.onOpenChange(false)
      setSearch("")
      setDebouncedSearch("")
      return
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" />
        <Dialog.Content
          class="fixed top-[20%] left-1/2 -translate-x-1/2 w-[90vw] max-w-2xl 
                 bg-background border border-border-subtle rounded-lg shadow-2xl z-[101]
                 max-h-[60vh] flex flex-col"
        >
          <div class="p-4 border-b border-border-subtle">
            <div class="relative">
              <Icon name="command" size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                ref={(el) => (inputRef = el)}
                type="text"
                value={search()}
                onInput={(e) => handleSearchInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type at least 2 characters to search files..."
                class="w-full pl-10 pr-4 py-2 bg-background-element border border-border-subtle 
                       rounded-md text-sm text-text placeholder-text-muted/70
                       focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
              <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <Show when={searchResults.loading}>
                  <div class="text-text-muted">
                    <Icon name="refresh" size={14} class="animate-spin" />
                  </div>
                </Show>
                <Show when={search() && !searchResults.loading}>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    class="text-text-muted hover:text-text"
                    onClick={() => {
                      setSearch("")
                      setDebouncedSearch("")
                    }}
                  >
                    <Icon name="close" size={14} />
                  </IconButton>
                </Show>
              </div>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-2">
            <Show
              when={displayFiles().length > 0}
              fallback={
                <div class="text-center py-8 text-text-muted text-sm">
                  {search().length >= 2 && !searchResults.loading
                    ? "No files found"
                    : search().length < 2
                      ? "Type at least 2 characters to search files"
                      : "Start typing to search files"}
                </div>
              }
            >
              <For each={displayFiles()}>
                {(file, index) => (
                  <button
                    onClick={() => handleSelect(file)}
                    onMouseEnter={() => setSelectedIndex(index())}
                    class="w-full px-3 py-2 flex items-center gap-3 rounded-md text-left
                            transition-colors group"
                    classList={{
                      "bg-background-element": selectedIndex() === index(),
                      "hover:bg-background-element": true,
                    }}
                  >
                    <FileIcon node={file} class="shrink-0" />
                    <div class="flex-1 min-w-0">
                      <div class="text-sm text-text truncate">{file.name}</div>
                      <div class="text-xs text-text-muted truncate">{file.path}</div>
                    </div>
                    <Icon
                      name="arrow-right"
                      size={14}
                      class="shrink-0 opacity-0 group-hover:opacity-100 text-text-muted"
                    />
                  </button>
                )}
              </For>
            </Show>
          </div>

          <div class="p-3 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
            <div class="flex items-center gap-4">
              <span class="flex items-center gap-1">
                <kbd class="px-1.5 py-0.5 bg-background-element border border-border-subtle rounded text-[10px]">
                  ↑↓
                </kbd>
                Navigate
              </span>
              <span class="flex items-center gap-1">
                <kbd class="px-1.5 py-0.5 bg-background-element border border-border-subtle rounded text-[10px]">↵</kbd>
                Open
              </span>
              <span class="flex items-center gap-1">
                <kbd class="px-1.5 py-0.5 bg-background-element border border-border-subtle rounded text-[10px]">
                  ESC
                </kbd>
                Close
              </span>
            </div>
            <span>{searchResults.loading ? "Searching..." : `${displayFiles().length} results`}</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
