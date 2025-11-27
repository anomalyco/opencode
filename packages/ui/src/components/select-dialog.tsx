import { createEffect, Show, For, type JSX, splitProps } from "solid-js"
import { createStore } from "solid-js/store"
import { FilteredListProps, useFilteredList } from "@opencode-ai/ui/hooks"
import { Dialog, DialogProps } from "./dialog"
import { Icon } from "./icon"
import { Input } from "./input"
import { IconButton } from "./icon-button"

interface SelectDialogProps<T>
  extends FilteredListProps<T>,
    Pick<DialogProps, "trigger" | "onOpenChange" | "defaultOpen"> {
  title: string
  placeholder?: string
  emptyMessage?: string
  children: (item: T) => JSX.Element
  onSelect?: (value: T | undefined) => void
  onKeyEvent?: (event: KeyboardEvent, item: T | undefined) => void
}

export function SelectDialog<T>(props: SelectDialogProps<T>) {
  const [dialog, others] = splitProps(props, ["trigger", "onOpenChange", "defaultOpen"])
  let closeButton!: HTMLButtonElement
  let scrollRef: HTMLDivElement | undefined
  const [store, setStore] = createStore({
    mouseActive: false,
  })

  const { filter, grouped, flat, reset, clear, active, setActive, onKeyDown, onInput } = useFilteredList<T>({
    items: others.items,
    key: others.key,
    filterKeys: others.filterKeys,
    current: others.current,
    groupBy: others.groupBy,
    sortBy: others.sortBy,
    sortGroupsBy: others.sortGroupsBy,
  })

  createEffect(() => {
    filter()
    scrollRef?.scrollTo(0, 0)
    reset()
  })

  createEffect(() => {
    const all = flat()
    if (store.mouseActive || all.length === 0) return
    if (active() === others.key(all[0])) {
      scrollRef?.scrollTo(0, 0)
      return
    }
    const element = scrollRef?.querySelector(`[data-key="${active()}"]`)
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  })

  const handleInput = (value: string) => {
    onInput(value)
    reset()
  }

  const handleSelect = (item: T | undefined) => {
    others.onSelect?.(item)
    closeButton.click()
  }

  const handleKey = (e: KeyboardEvent) => {
    setStore("mouseActive", false)
    if (e.key === "Escape") return

    const all = flat()
    const selected = all.find((x) => others.key(x) === active())
    props.onKeyEvent?.(e, selected)

    if (e.key === "Enter") {
      e.preventDefault()
      if (selected) handleSelect(selected)
    } else {
      onKeyDown(e)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) clear()
    props.onOpenChange?.(open)
  }

  return (
    <Dialog modal {...dialog} onOpenChange={handleOpenChange}>
      <Dialog.Header>
        <Dialog.Title>{others.title}</Dialog.Title>
        <Dialog.CloseButton ref={closeButton} style={{ display: "none" }} />
      </Dialog.Header>
      <div data-component="select-dialog-input">
        <div data-slot="select-dialog-input-container">
          <Icon data-slot="select-dialog-icon" name="magnifying-glass" />
          <Input
            data-slot="select-dialog-input"
            type="text"
            value={filter()}
            onChange={(value) => handleInput(value)}
            onKeyDown={handleKey}
            placeholder={others.placeholder}
            autofocus
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
          />
        </div>
        <Show when={filter()}>
          <IconButton
            data-slot="select-dialog-clear-button"
            icon="circle-x"
            variant="ghost"
            onClick={() => {
              onInput("")
              reset()
            }}
          />
        </Show>
      </div>
      <Dialog.Body ref={scrollRef} data-component="select-dialog" class="no-scrollbar">
        <Show
          when={flat().length > 0}
          fallback={
            <div data-slot="select-dialog-empty-state">
              <div data-slot="select-dialog-message">
                {props.emptyMessage ?? "No search results"} for{" "}
                <span data-slot="select-dialog-filter">&quot;{filter()}&quot;</span>
              </div>
            </div>
          }
        >
          <For each={grouped()}>
            {(group) => (
              <div data-slot="select-dialog-group">
                <Show when={group.category}>
                  <div data-slot="select-dialog-header">{group.category}</div>
                </Show>
                <div data-slot="select-dialog-list">
                  <For each={group.items}>
                    {(item) => (
                      <button
                        data-slot="select-dialog-item"
                        data-key={others.key(item)}
                        data-active={others.key(item) === active()}
                        onClick={() => handleSelect(item)}
                        onMouseMove={() => {
                          setStore("mouseActive", true)
                          setActive(others.key(item))
                        }}
                      >
                        {others.children(item)}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </Show>
      </Dialog.Body>
    </Dialog>
  )
}
