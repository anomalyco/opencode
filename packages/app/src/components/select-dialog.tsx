import { createEffect, Show, For, createMemo, type JSX, createResource } from "solid-js"
import { Dialog } from "@kobalte/core/dialog"
import { Icon, IconButton } from "@/ui"
import { createStore } from "solid-js/store"
import { entries, flatMap, groupBy, map, pipe } from "remeda"
import { createList } from "solid-list"
import fuzzysort from "fuzzysort"

interface SelectDialogProps<T> {
  items: T[] | ((filter: string) => Promise<T[]>)
  key: (item: T) => string
  render: (item: T) => JSX.Element
  filter?: string[]
  current?: T
  placeholder?: string
  groupBy?: (x: T) => string
  onSelect?: (value: T | undefined) => void
  onClose?: () => void
}

export function SelectDialog<T>(props: SelectDialogProps<T>) {
  let scrollRef: HTMLDivElement | undefined
  const [store, setStore] = createStore({
    filter: "",
    mouseActive: false,
  })

  const [grouped] = createResource(
    () => store.filter,
    async (filter) => {
      const needle = filter.toLowerCase()
      const all = (typeof props.items === "function" ? await props.items(needle) : props.items) || []
      const result = pipe(
        all,
        (x) => {
          if (!needle) return x
          if (!props.filter && Array.isArray(x) && x.every((e) => typeof e === "string")) {
            return fuzzysort.go(needle, x).map((x) => x.target) as T[]
          }
          return fuzzysort.go(needle, x, { keys: props.filter! }).map((x) => x.obj)
        },
        groupBy((x) => (props.groupBy ? props.groupBy(x) : "")),
        // mapValues((x) => x.sort((a, b) => props.key(a).localeCompare(props.key(b)))),
        entries(),
        map(([k, v]) => ({ category: k, items: v })),
      )
      return result
    },
  )
  const flat = createMemo(() => {
    return pipe(
      grouped() || [],
      flatMap((x) => x.items),
    )
  })
  const list = createList({
    items: () => flat().map(props.key),
    initialActive: props.current ? props.key(props.current) : undefined,
    loop: true,
  })
  const resetSelection = () => {
    const all = flat()
    if (all.length === 0) return
    list.setActive(props.key(all[0]))
  }

  createEffect(() => {
    store.filter
    scrollRef?.scrollTo(0, 0)
    resetSelection()
  })

  createEffect(() => {
    const all = flat()
    if (store.mouseActive || all.length === 0) return
    if (list.active() === props.key(all[0])) {
      scrollRef?.scrollTo(0, 0)
      return
    }
    const element = scrollRef?.querySelector(`[data-key="${list.active()}"]`)
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  })

  const handleInput = (value: string) => {
    setStore("filter", value)
    resetSelection()
  }

  const handleSelect = (item: T) => {
    props.onSelect?.(item)
    props.onClose?.()
  }

  const handleKey = (e: KeyboardEvent) => {
    setStore("mouseActive", false)

    if (e.key === "Enter") {
      e.preventDefault()
      const selected = flat().find((x) => props.key(x) === list.active())
      if (selected) handleSelect(selected)
    } else if (e.key === "Escape") {
      e.preventDefault()
      props.onClose?.()
    } else {
      list.onKeyDown(e)
    }
  }

  return (
    <Dialog defaultOpen modal onOpenChange={(open) => open || props.onClose?.()}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" />
        <Dialog.Content
          class="fixed top-[20%] left-1/2 -translate-x-1/2 w-[90vw] max-w-2xl 
                 shadow-[0_0_33px_rgba(0,0,0,0.8)]
                 bg-background border border-border-subtle/30 rounded-lg  z-[101]
                 max-h-[60vh] flex flex-col"
        >
          <div class="border-b border-border-subtle/30">
            <div class="relative">
              <Icon name="command" size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/80" />
              <input
                type="text"
                value={store.filter}
                onInput={(e) => handleInput(e.currentTarget.value)}
                onKeyDown={handleKey}
                placeholder={props.placeholder}
                class="w-full pl-10 pr-4 py-2 rounded-t-md
                       text-sm text-text placeholder-text-muted/70
                       focus:outline-none"
                autofocus
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
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
                      resetSelection()
                    }}
                  >
                    <Icon name="close" size={14} />
                  </IconButton>
                </Show>
              </div>
            </div>
          </div>
          <div ref={(el) => (scrollRef = el)} class="relative flex-1 overflow-y-auto">
            <Show
              when={flat().length > 0}
              fallback={<div class="text-center py-8 text-text-muted text-sm">No results</div>}
            >
              <For each={grouped()}>
                {(group) => (
                  <>
                    <Show when={group.category}>
                      <div class="top-0 sticky z-10 bg-background-panel p-2 text-xs text-text-muted/60 tracking-wider uppercase">
                        {group.category}
                      </div>
                    </Show>
                    <div class="p-2">
                      <For each={group.items}>
                        {(item) => (
                          <button
                            data-key={props.key(item)}
                            onClick={() => handleSelect(item)}
                            onMouseMove={() => {
                              setStore("mouseActive", true)
                              list.setActive(props.key(item))
                            }}
                            classList={{
                              "w-full px-3 py-2 flex items-center gap-3": true,
                              "rounded-md text-left transition-colors group": true,
                              "bg-background-element": props.key(item) === list.active(),
                            }}
                          >
                            {props.render(item)}
                          </button>
                        )}
                      </For>
                    </div>
                  </>
                )}
              </For>
            </Show>
          </div>
          <div class="p-3 border-t border-border-subtle/30 flex items-center justify-between text-xs text-text-muted">
            <div class="flex items-center gap-5">
              <span class="flex items-center gap-1.5">
                <kbd class="px-1.5 py-0.5 bg-background-element border border-border-subtle/30 rounded text-[10px]">
                  ↑↓
                </kbd>
                Navigate
              </span>
              <span class="flex items-center gap-1.5">
                <kbd class="px-1.5 py-0.5 bg-background-element border border-border-subtle/30 rounded text-[10px]">
                  ↵
                </kbd>
                Select
              </span>
              <span class="flex items-center gap-1.5">
                <kbd class="px-1.5 py-0.5 bg-background-element border border-border-subtle/30 rounded text-[10px]">
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
