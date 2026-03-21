import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Keybind } from "@opencode-ai/ui/keybind"
import { List } from "@opencode-ai/ui/list"
import { createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js"
import { formatKeybind, type CommandOption } from "@/context/command"

const ENTRY_LIMIT = 5
const COMMON_COMMAND_IDS = [
  "session.new",
  "workspace.new",
  "session.previous",
  "session.next",
  "terminal.toggle",
  "review.toggle",
] as const

type Entry = {
  id: string
  title: string
  description?: string
  category: string
  keybind?: string
  option: CommandOption
}

const entry = (option: CommandOption, category: string): Entry => ({
  id: option.id,
  title: option.title,
  description: option.description,
  category,
  keybind: option.keybind,
  option,
})

export function DialogCommandPalette(props: {
  options: Accessor<CommandOption[]>
  commands: string
  placeholder: string
  empty: string
  loading: string
  t: (key: string) => string
}) {
  const dialog = useDialog()
  const [grouped, setGrouped] = createSignal(false)
  const state = { cleanup: undefined as (() => void) | void, committed: false }
  const options = createMemo(() =>
    props.options().filter((item) => !item.disabled && !item.id.startsWith("suggested.") && item.id !== "file.open"),
  )
  const list = createMemo(() => options().map((item) => entry(item, props.commands)))
  const picks = createMemo(() => {
    const order = new Map<string, number>(COMMON_COMMAND_IDS.map((id, i) => [id, i]))
    const picked = options().filter((item) => order.has(item.id))
    const base = picked.length ? picked : options().slice(0, ENTRY_LIMIT)
    const items = picked.length ? [...base].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : base
    return items.map((item) => entry(item, props.commands))
  })

  const items = (text: string) => {
    setGrouped(text.trim().length > 0)
    return text.trim() ? list() : picks()
  }

  const move = (item: Entry | undefined) => {
    state.cleanup?.()
    if (!item) return
    state.cleanup = item.option.onHighlight?.()
  }

  const select = (item: Entry | undefined) => {
    if (!item) return
    state.committed = true
    state.cleanup = undefined
    dialog.close()
    item.option.onSelect?.("palette")
  }

  onCleanup(() => {
    if (state.committed) return
    state.cleanup?.()
  })

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]" transition>
      <List
        search={{
          placeholder: props.placeholder,
          autofocus: true,
          hideIcon: true,
        }}
        emptyMessage={props.empty}
        loadingMessage={props.loading}
        items={items}
        key={(item) => item.id}
        filterKeys={["title", "description", "category"]}
        groupBy={grouped() ? (item) => item.category : () => ""}
        onMove={move}
        onSelect={select}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between gap-4">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-14-regular text-text-strong whitespace-nowrap">{item.title}</span>
              <Show when={item.description}>
                <span class="text-14-regular text-text-weak truncate">{item.description}</span>
              </Show>
            </div>
            <Show when={item.keybind}>
              <Keybind class="rounded-[4px]">{formatKeybind(item.keybind ?? "", props.t)}</Keybind>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
