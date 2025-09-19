import { createSignal, createEffect, Show, For, createMemo, createResource, onCleanup } from "solid-js"
import { Dialog } from "@kobalte/core/dialog"
import { FileIcon, Icon, IconButton } from "@/ui"
import { useLocal, useSDK, useSync } from "@/context"
import type { FileNode } from "@opencode-ai/sdk"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type CommandMode = "files" | "commands" | "models"

interface Command {
  id: string
  name: string
  description?: string
  icon?: string
  action: () => void
}

type FileItem = FileNode & { kind: "file" }
interface CommandItem extends Command {
  kind: "command"
}
interface ModelItem {
  kind: "model"
  id: string
  providerID: string
  modelID: string
  name: string
  provider: string
  isRecent: boolean
  searchText: string
  action: () => void
}

type Item = FileItem | CommandItem | ModelItem

function deriveMode(value: string, current: CommandMode): CommandMode {
  if (value.startsWith(">")) return "commands"
  if (current === "commands") return "files"
  return current
}

export default function CommandPalette(props: CommandPaletteProps) {
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()

  const [search, setSearch] = createSignal("")
  const [debouncedSearch, setDebouncedSearch] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [mode, setMode] = createSignal<CommandMode>("files")

  let inputRef: HTMLInputElement | undefined
  let scrollRef: HTMLDivElement | undefined
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (searchTimer) clearTimeout(searchTimer)
  })

  const scrollToSelected = (index: number) => {
    requestAnimationFrame(() => {
      if (!scrollRef) return
      const nodes = scrollRef.querySelectorAll("[data-cmd-item]")
      const el = nodes[index] as HTMLElement | undefined
      if (!el) return
      el.scrollIntoView({ block: "nearest", behavior: "instant" })
    })
  }

  const commands = createMemo<CommandItem[]>(() => [
    {
      id: "select-model",
      name: "Select Model",
      description: "Change the current AI model",
      icon: "cpu",
      action: () => {
        setMode("models")
        setSearch("")
        setDebouncedSearch("")
        setSelectedIndex(0)
      },
      kind: "command",
    },
  ])

  const models = createMemo<ModelItem[]>(() => {
    const providers = sync.data?.provider ?? []

    const recentModels = local.model
      .recent()
      .slice(0, 4)
      .map((recentModel) => {
        const provider = providers.find((p) => p.id === recentModel.providerID)
        const model = provider?.models?.[recentModel.modelID]
        return {
          kind: "model" as const,
          id: `${recentModel.providerID}:${recentModel.modelID}`,
          providerID: recentModel.providerID,
          modelID: recentModel.modelID,
          name: model?.name || recentModel.modelID,
          provider: provider?.name || recentModel.providerID,
          isRecent: true,
          searchText: (
            (model?.name || recentModel.modelID) +
            " " +
            (provider?.name || recentModel.providerID)
          ).toLowerCase(),
          action: () => {
            local.model.set({ providerID: recentModel.providerID, modelID: recentModel.modelID }, { recent: true })
            props.onOpenChange(false)
            setSearch("")
            setDebouncedSearch("")
            setMode("files")
          },
        }
      })

    const allModels = providers.flatMap((provider) =>
      Object.entries(provider.models ?? {}).map(([modelId, model]) => ({
        kind: "model" as const,
        id: `${provider.id}:${modelId}`,
        providerID: provider.id,
        modelID: modelId,
        name: model.name || modelId,
        provider: provider.name || provider.id,
        isRecent: false,
        searchText: ((model.name || modelId) + " " + (provider.name || provider.id)).toLowerCase(),
        action: () => {
          local.model.set({ providerID: provider.id, modelID: modelId }, { recent: true })
          props.onOpenChange(false)
          setSearch("")
          setDebouncedSearch("")
          setMode("files")
        },
      })),
    )

    const recentIds = new Set(recentModels.map((m) => m.id))
    const otherModels = allModels.filter((m) => !recentIds.has(m.id))

    return [...recentModels, ...otherModels]
  })

  const modelSplitIndex = createMemo(() => {
    const list = models()
    return list.findIndex((m) => !m.isRecent)
  })

  const [fileResults] = createResource(
    () => {
      if (mode() !== "files") return null
      const q = debouncedSearch().trim()
      if (q.length < 2) return ""
      return q
    },
    async (query) => {
      if (!query) return [] as FileItem[]

      const res = await sdk.find.files({ query: { query } })
      const paths: string[] = res.data ?? []
      const files: FileItem[] = paths.map((path) => {
        const name = path.split("/").pop() || path
        const base: FileNode = { name, path, absolute: path, type: "file" as const, ignored: false }
        const node = local.file.node(base.path) ?? base
        return { ...(node as FileNode), kind: "file" }
      })

      return files
    },
    { initialValue: [] as FileItem[] },
  )

  const filteredCommands = createMemo<CommandItem[]>(() => {
    const q = debouncedSearch().trim().toLowerCase()
    if (!q) return commands()
    return commands().filter((cmd) => cmd.name.toLowerCase().includes(q) || cmd.description?.toLowerCase().includes(q))
  })

  const filteredModels = createMemo<ModelItem[]>(() => {
    const q = debouncedSearch().trim().toLowerCase()
    if (!q) return models()
    return models().filter((m) => m.searchText.includes(q))
  })

  const displayItems = createMemo<Item[]>(() => {
    if (mode() === "files") return fileResults() ?? []
    if (mode() === "commands") return filteredCommands()
    return filteredModels()
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

  const handleSearchInput = (value: string) => {
    setSearch(value)
    const next = deriveMode(value, mode())
    if (next !== mode()) setMode(next)
    setSelectedIndex(0)

    if (searchTimer) clearTimeout(searchTimer)

    const q = value.startsWith(">") ? value.slice(1) : value
    searchTimer = setTimeout(() => setDebouncedSearch(q), 150)
  }

  const handleSelect = (item: Item) => {
    if (item.kind === "file") {
      local.file.open(item.path)
      props.onOpenChange(false)
      setSearch("")
      setDebouncedSearch("")
      setMode("files")
      return
    }
    item.action?.()
  }

  const updateIndex = (i: number) => {
    const len = displayItems().length
    if (len <= 0) {
      setSelectedIndex(0)
      return
    }
    const clamped = Math.min(Math.max(i, 0), len - 1)
    setSelectedIndex(clamped)
    scrollToSelected(clamped)
  }

  const handleKey = (e: KeyboardEvent) => {
    const items = displayItems()

    if (e.key === "ArrowDown") {
      e.preventDefault()
      updateIndex(selectedIndex() + 1)
      return
    }

    if (e.key === "ArrowUp") {
      e.preventDefault()
      updateIndex(selectedIndex() - 1)
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      const selected = items[selectedIndex()]
      if (selected) handleSelect(selected)
      return
    }

    if (e.key === "Escape") {
      e.preventDefault()
      if (mode() !== "files") {
        setMode("files")
        setSearch("")
        setDebouncedSearch("")
      } else {
        props.onOpenChange(false)
        setSearch("")
        setDebouncedSearch("")
      }
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
                onKeyDown={handleKey}
                placeholder={
                  mode() === "commands"
                    ? "Search commands..."
                    : mode() === "models"
                      ? "Search models..."
                      : "Type > for commands or search files..."
                }
                class="w-full pl-10 pr-4 py-2 bg-background-element border border-border-subtle 
                       rounded-md text-sm text-text placeholder-text-muted/70
                       focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
              <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <Show when={fileResults.loading && mode() === "files"}>
                  <div class="text-text-muted">
                    <Icon name="refresh" size={14} class="animate-spin" />
                  </div>
                </Show>
                <Show when={search() && !fileResults.loading}>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    class="text-text-muted hover:text-text"
                    onClick={() => {
                      setSearch("")
                      setDebouncedSearch("")
                      setSelectedIndex(0)
                      if (mode() === "commands") setMode("files")
                    }}
                  >
                    <Icon name="close" size={14} />
                  </IconButton>
                </Show>
              </div>
            </div>
          </div>

          <div ref={(el) => (scrollRef = el)} class="flex-1 overflow-y-auto p-2">
            <Show
              when={displayItems().length > 0}
              fallback={
                <div class="text-center py-8 text-text-muted text-sm">
                  {mode() === "commands" && search().length === 0
                    ? "Available commands"
                    : mode() === "models" && search().length === 0
                      ? "Available models"
                      : fileResults.loading && mode() === "files"
                        ? "Searching..."
                        : mode() === "files" && search().length < 2
                          ? "Type > for commands or at least 2 characters to search files"
                          : "No results found"}
                </div>
              }
            >
              <For each={displayItems()}>
                {(item, index) => (
                  <>
                    <Show
                      when={
                        mode() === "models" &&
                        (!search() || search().trim().length === 0) &&
                        (item as ModelItem).kind === "model" &&
                        (item as ModelItem).isRecent === true &&
                        index() === 0
                      }
                    >
                      <div class="px-2 py-1 text-xs font-medium text-text-muted uppercase tracking-wide">Recent</div>
                    </Show>
                    <Show
                      when={
                        mode() === "models" &&
                        (!search() || search().trim().length === 0) &&
                        index() === modelSplitIndex()
                      }
                    >
                      <div class="border-t border-border-subtle my-2"></div>
                      <div class="px-2 py-1 text-xs font-medium text-text-muted uppercase tracking-wide">All</div>
                    </Show>
                    <button
                      data-cmd-item
                      onClick={() => handleSelect(item as Item)}
                      onMouseEnter={() => setSelectedIndex(index())}
                      class="w-full px-3 py-2 flex items-center gap-3 rounded-md text-left
                              transition-colors group"
                      classList={{
                        "bg-background-element": selectedIndex() === index(),
                        "hover:bg-background-element": true,
                      }}
                    >
                      <Show
                        when={(item as Item).kind === "file"}
                        fallback={
                          <Icon
                            name={(item as Item).kind === "command" ? "command" : "cpu"}
                            size={16}
                            class="shrink-0 text-text-muted"
                          />
                        }
                      >
                        <FileIcon node={item as FileNode} class="shrink-0" />
                      </Show>
                      <div class="flex-1 min-w-0">
                        <div class="text-sm text-text truncate">
                          {(item as Item).kind === "file"
                            ? (item as FileItem).name
                            : (item as CommandItem | ModelItem).name}
                        </div>
                        <div class="text-xs text-text-muted truncate">
                          {(item as Item).kind === "file"
                            ? (item as FileItem).path
                            : (item as Item).kind === "command"
                              ? (item as CommandItem).description
                              : (item as ModelItem).provider}
                        </div>
                      </div>

                      <Icon
                        name="arrow-right"
                        size={14}
                        class="shrink-0 opacity-0 group-hover:opacity-100 text-text-muted"
                      />
                    </button>
                  </>
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
            <span>
              {fileResults.loading && mode() === "files" ? "Searching..." : `${displayItems().length} results`}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
