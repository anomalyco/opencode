import { Component, createMemo, createSignal, For, Show } from "solid-js"
import type { PromptHistoryStoredEntry } from "./history"
import { normalizePromptHistoryEntry } from "./history"

type Props = {
  open: boolean
  entries: PromptHistoryStoredEntry[]
  onSelect: (text: string) => void
  onClose: () => void
}

function entryText(entry: PromptHistoryStoredEntry): string {
  const normalized = normalizePromptHistoryEntry(entry)
  return normalized.prompt
    .map((p) => ("content" in p ? p.content : ""))
    .join("")
    .trim()
}

export const HistorySearchPopover: Component<Props> = (props) => {
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)

  const filtered = createMemo(() => {
    const q = query().toLowerCase()
    const all = props.entries.map(entryText).filter(Boolean)
    if (!q) return all.slice(0, 8)
    return all.filter((t) => t.toLowerCase().includes(q)).slice(0, 8)
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      props.onClose()
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered().length - 1))
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      const item = filtered()[active()]
      if (item) props.onSelect(item)
    }
  }

  return (
    <Show when={props.open}>
      <div
        data-component="history-search"
        class="absolute inset-x-0 -top-2 -translate-y-full origin-bottom-left max-h-80
               overflow-hidden flex flex-col rounded-[12px]
               bg-surface-raised-stronger-non-alpha shadow-[var(--shadow-lg-border-base)]"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div class="px-3 pt-2.5 pb-1.5 border-b border-border-weak-base">
          <input
            autofocus
            placeholder="Search history…"
            class="w-full bg-transparent text-14-regular text-text-strong placeholder:text-text-weakest outline-none"
            value={query()}
            onInput={(e) => { setQuery(e.currentTarget.value); setActive(0) }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div class="overflow-y-auto no-scrollbar flex flex-col p-2">
          <Show
            when={filtered().length > 0}
            fallback={<div class="text-12-regular text-text-weak px-2 py-1.5">No matches</div>}
          >
            <For each={filtered()}>
              {(item, i) => (
                <button
                  class="w-full text-left rounded-md px-2 py-1 text-13-regular text-text-strong truncate transition-colors"
                  classList={{ "bg-surface-raised-base-hover": active() === i() }}
                  onClick={() => props.onSelect(item)}
                  onMouseEnter={() => setActive(i())}
                >
                  {item}
                </button>
              )}
            </For>
          </Show>
        </div>
        <div class="px-3 py-1.5 border-t border-border-weak-base flex items-center gap-3 text-11-regular text-text-weakest">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </Show>
  )
}
