import { createEffect, Show, For, createMemo, type JSX } from "solid-js"
import { Dialog } from "@kobalte/core/dialog"
import { Icon, IconButton } from "@/ui"
import { createStore } from "solid-js/store"
import { entries, flatMap, groupBy, map, pipe } from "remeda"
import fuzzysort from "fuzzysort"

interface CommandPaletteProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void

  items: T[]
  key: (item: T) => string
  render: (itemProps: { item: T }) => JSX.Element

  current?: T
  placeholder?: string
  filter?:
    | false
    | {
        placeholder?: string
        keys: string[]
      }
  groupBy?: (x: T) => string
  onFilter?: (query: string) => void
  onSelect?: (value: T | undefined) => void
}

export default function CommandPalette<T>(props: CommandPaletteProps<T>) {
  let inputRef: HTMLInputElement | undefined
  let scrollRef: HTMLDivElement | undefined

  // const local = useLocal()
  // const sdk = useSDK()
  // const sync = useSync()
  const [store, setStore] = createStore({
    filter: "",
    selected: 0,
  })

  const grouped = createMemo(() => {
    const needle = store.filter.toLowerCase()
    const result = pipe(
      props.items,
      (x) =>
        !needle || !props.filter
          ? x
          : fuzzysort.go(needle, x, { keys: props.filter && props.filter.keys }).map((x) => x.obj),
      groupBy((x) => (props.groupBy ? props.groupBy(x) : "")),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
      map(([k, v]) => ({ category: k, items: v })),
    )
    return result
  })
  const flat = createMemo(() => {
    return pipe(
      grouped(),
      flatMap(({ items }) => items),
    )
  })

  createEffect(() => {
    store.filter
    scrollRef?.scrollTo(0, 0)
    setStore("selected", 0)
  })

  createEffect(() => {
    const element = scrollRef?.querySelector(`[data-item-key="${props.key(flat()[store.selected])}"]`)
    element?.scrollIntoView({ block: "center", behavior: "smooth" })
  })

  const handleInput = (value: string) => {
    setStore("filter", value)
    setStore("selected", 0)
  }

  const handleSelect = (item: T) => {
    props.onSelect?.(item)
  }

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setStore("selected", Math.max(0, store.selected - 1))
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setStore("selected", Math.min(flat().length - 1, store.selected + 1))
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      const selected = props.items[store.selected]
      if (selected) handleSelect(selected)
      return
    }

    if (e.key === "Escape") {
      e.preventDefault()
      // if (mode() !== "files") {
      //   setMode("files")
      //   setSearch("")
      //   setDebouncedSearch("")
      // } else {
      //   props.onOpenChange(false)
      //   setSearch("")
      //   setDebouncedSearch("")
      // }
      return
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" />
        <Dialog.Content
          class="fixed top-[20%] left-1/2 -translate-x-1/2 w-[90vw] max-w-2xl 
                 shadow-[0_0_33px_rgba(0,0,0,0.8)]
                 bg-background border border-border-subtle rounded-lg  z-[101]
                 max-h-[60vh] flex flex-col"
        >
          <div class="border-b border-border-subtle">
            <div class="relative">
              <Icon name="command" size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                ref={(el) => (inputRef = el)}
                type="text"
                value={store.filter}
                onInput={(e) => handleInput(e.currentTarget.value)}
                onKeyDown={handleKey}
                placeholder={props.placeholder}
                class="w-full pl-10 pr-4 py-2 rounded-t-md
                       text-sm text-text placeholder-text-muted/70
                       focus:outline-none"
              />
              <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {/* <Show when={fileResults.loading && mode() === "files"}>
                  <div class="text-text-muted">
                    <Icon name="refresh" size={14} class="animate-spin" />
                  </div>
                </Show> */}
                <Show when={store.filter}>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    class="text-text-muted hover:text-text"
                    onClick={() => {
                      setStore("filter", "")
                      setStore("selected", 0)
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
              when={flat().length > 0}
              fallback={<div class="text-center py-8 text-text-muted text-sm">No results</div>}
            >
              <For each={grouped()}>
                {(group, groupIndex) => (
                  <>
                    <span>{group.category}</span>
                    <For each={group.items}>
                      {(item, index) => (
                        <button
                          data-item-key={props.key(item)}
                          onClick={() => handleSelect(item)}
                          classList={{
                            "w-full px-3 py-2 flex items-center gap-3": true,
                            "rounded-md text-left transition-colors group": true,
                            "bg-background-element": store.selected === index() + groupIndex(),
                            "hover:bg-background-element": true,
                            "first:before:content-['']": true,
                          }}
                        >
                          {props.render({ item })}
                          <Icon
                            name="arrow-right"
                            size={14}
                            class="shrink-0 opacity-0 group-hover:opacity-100 text-text-muted"
                          />
                        </button>
                      )}
                    </For>
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
            <span>{`${flat().length} results`}</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
