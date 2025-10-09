import { createEffect, Show, For, onMount, onCleanup } from "solid-js"
import { FileIcon, Icon } from "@/ui"
import { createList } from "solid-list"

export interface AutocompleteItem {
  type: "file" | "command"
  label: string
  value: string
  description?: string
}

interface AutocompleteDropdownProps {
  items: AutocompleteItem[]
  position: { top: number; left: number }
  onSelect: (item: AutocompleteItem) => void
  onClose: () => void
}

export function AutocompleteDropdown(props: AutocompleteDropdownProps) {
  let containerRef: HTMLDivElement | undefined

  const list = createList({
    items: () => props.items.map((item) => item.value),
    initialActive: props.items[0]?.value,
    loop: true,
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      props.onClose()
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      e.stopPropagation()
      const selected = props.items.find((x) => x.value === list.active())
      if (selected) props.onSelect(selected)
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      e.stopPropagation()
      list.onKeyDown(e)
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true })
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown, { capture: true })
  })

  createEffect(() => {
    if (props.items.length > 0 && !props.items.find((x) => x.value === list.active())) {
      list.setActive(props.items[0].value)
    }
  })

  return (
    <Show when={props.items.length > 0}>
      <div
        ref={containerRef}
        style={{
          position: "fixed",
          top: `${props.position.top}px`,
          left: `${props.position.left}px`,
          "z-index": "1000",
        }}
        class="w-80 max-h-64 overflow-y-auto bg-background-panel border border-border-subtle/30 rounded-lg shadow-[0_0_33px_rgba(0,0,0,0.8)]"
      >
        <For each={props.items}>
          {(item) => (
            <button
              onClick={() => props.onSelect(item)}
              onMouseEnter={() => list.setActive(item.value)}
              classList={{
                "w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-background-element transition-colors": true,
                "bg-background-element": list.active() === item.value,
              }}
            >
              <Show
                when={item.type === "file"}
                fallback={<Icon name="command" size={16} class="text-text-muted shrink-0" />}
              >
                <FileIcon node={{ path: item.value, type: "file" }} class="shrink-0 size-4" />
              </Show>
              <div class="flex-1 min-w-0">
                <div class="text-xs text-text truncate">{item.label}</div>
                <Show when={item.description}>
                  <div class="text-xs text-text-muted/60 truncate">{item.description}</div>
                </Show>
              </div>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
