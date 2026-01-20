import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Keybind } from "@opencode-ai/ui/keybind"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useParams } from "@solidjs/router"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { formatKeybind, useCommand, type CommandOption } from "@/context/command"
import { useLayout } from "@/context/layout"
import { useFile } from "@/context/file"

type EntryType = "command" | "file"

type Entry = {
  id: string
  type: EntryType
  title: string
  description?: string
  keybind?: string
  category: "Commands" | "Files"
  option?: CommandOption
  path?: string
}

export function DialogSelectFile() {
  const command = useCommand()
  const layout = useLayout()
  const file = useFile()
  const dialog = useDialog()
  const params = useParams()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))
  const view = createMemo(() => layout.view(sessionKey()))
  const state = { cleanup: undefined as (() => void) | void, committed: false }
  const [grouped, setGrouped] = createSignal(false)
  const common = ["session.new", "session.previous", "session.next", "terminal.toggle", "review.toggle"]
  const limit = 5

  const allowed = createMemo(() =>
    command.options.filter(
      (option) => !option.disabled && !option.id.startsWith("suggested.") && option.id !== "file.open",
    ),
  )

  const commandItem = (option: CommandOption): Entry => ({
    id: "command:" + option.id,
    type: "command",
    title: option.title,
    description: option.description,
    keybind: option.keybind,
    category: "Commands",
    option,
  })

  const fileItem = (path: string): Entry => ({
    id: "file:" + path,
    type: "file",
    title: path,
    category: "Files",
    path,
  })

  const list = createMemo(() => allowed().map(commandItem))

  const picks = createMemo(() => {
    const all = allowed()
    const order = new Map(common.map((id, index) => [id, index]))
    const picked = all.filter((option) => order.has(option.id))
    const base = picked.length ? picked : all.slice(0, limit)
    const sorted = picked.length ? [...base].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : base
    return sorted.map(commandItem)
  })

  const recent = createMemo(() => {
    const all = tabs().all()
    const active = tabs().active()
    const order = active ? [active, ...all.filter((item) => item !== active)] : all
    const seen = new Set<string>()
    const items: Entry[] = []

    for (const item of order) {
      const path = file.pathFromTab(item)
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      items.push(fileItem(path))
    }

    return items.slice(0, limit)
  })

  const items = async (filter: string) => {
    const query = filter.trim()
    setGrouped(query.length > 0)
    if (!query) return [...picks(), ...recent()]
    const files = await file.searchFiles(query)
    const entries = files.map(fileItem)
    return [...list(), ...entries]
  }

  const handleMove = (item: Entry | undefined) => {
    state.cleanup?.()
    if (!item) return
    if (item.type !== "command") return
    state.cleanup = item.option?.onHighlight?.()
  }

  const open = (path: string) => {
    const value = file.tab(path)
    tabs().open(value)
    file.load(path)
    view().reviewPanel.open()
  }

  const handleSelect = (item: Entry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()

    if (item.type === "command") {
      item.option?.onSelect?.("palette")
      return
    }

    if (!item.path) return
    open(item.path)
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]">
      <List
        search={{ placeholder: "Search files and commands", autofocus: true, hideIcon: true, class: "pl-3 pr-2 !mb-0" }}
        emptyMessage="No results found"
        items={items}
        key={(item) => item.id}
        filterKeys={["title", "description", "category"]}
        groupBy={(item) => item.category}
        onMove={handleMove}
        onSelect={handleSelect}
      >
        {(item) => (
          <Show
            when={item.type === "command"}
            fallback={
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.path ?? "", type: "file" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular">
                    <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                      {getDirectory(item.path ?? "")}
                    </span>
                    <span class="text-text-strong whitespace-nowrap">{getFilename(item.path ?? "")}</span>
                  </div>
                </div>
              </div>
            }
          >
            <div class="w-full flex items-center justify-between gap-4 pl-1">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-14-regular text-text-strong whitespace-nowrap">{item.title}</span>
                <Show when={item.description}>
                  <span class="text-14-regular text-text-weak truncate">{item.description}</span>
                </Show>
              </div>
              <Show when={item.keybind}>
                <Keybind class="rounded-[4px]">{formatKeybind(item.keybind ?? "")}</Keybind>
              </Show>
            </div>
          </Show>
        )}
      </List>
    </Dialog>
  )
}
