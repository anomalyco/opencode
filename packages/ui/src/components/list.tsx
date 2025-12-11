import { createEffect, Show, For, type JSX, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { FilteredListProps, useFilteredList } from "@opencode-ai/ui/hooks"
import { Icon, IconProps } from "./icon"

export interface ListProps<T> extends FilteredListProps<T> {
  class?: string
  children: (item: T) => JSX.Element
  emptyMessage?: string
  onKeyEvent?: (event: KeyboardEvent, item: T | undefined) => void
  activeIcon?: IconProps["name"]
  filter?: string
}

export interface ListRef {
  onKeyDown: (e: KeyboardEvent) => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
}

export function List<T>(props: ListProps<T> & { ref?: (ref: ListRef) => void }) {
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement | undefined>(undefined)
  const [store, setStore] = createStore({
    mouseActive: false,
  })

  const { filter, grouped, flat, reset, active, setActive, onKeyDown, onInput } = useFilteredList<T>({
    items: props.items,
    key: props.key,
    filterKeys: props.filterKeys,
    current: props.current,
    groupBy: props.groupBy,
    sortBy: props.sortBy,
    sortGroupsBy: props.sortGroupsBy,
  })

  createEffect(() => {
    if (props.filter === undefined) return
    onInput(props.filter)
  })

  createEffect(() => {
    filter()
    scrollRef()?.scrollTo(0, 0)
    reset()
  })

  createEffect(() => {
    if (!scrollRef()) return
    if (!props.current) return
    const key = props.key(props.current)
    requestAnimationFrame(() => {
      const element = scrollRef()!.querySelector(`[data-key="${key}"]`)
      element?.scrollIntoView({ block: "center" })
    })
  })

  createEffect(() => {
    const all = flat()
    if (store.mouseActive || all.length === 0) return
    if (active() === props.key(all[0])) {
      scrollRef()?.scrollTo(0, 0)
      return
    }
    const element = scrollRef()?.querySelector(`[data-key="${active()}"]`)
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  })

  const handleSelect = (item: T | undefined, index: number) => {
    props.onSelect?.(item, index)
  }

  const handleKey = (e: KeyboardEvent) => {
    setStore("mouseActive", false)
    if (e.key === "Escape") return

    const all = flat()
    const selected = all.find((x) => props.key(x) === active())
    const index = selected ? all.indexOf(selected) : -1
    props.onKeyEvent?.(e, selected)

    if (e.key === "Enter") {
      e.preventDefault()
      if (selected) handleSelect(selected, index)
    } else {
      onKeyDown(e)
    }
  }

  props.ref?.({
    onKeyDown: handleKey,
    setScrollRef,
  })

  return (
    <div ref={setScrollRef} data-component="list" classList={{ [props.class ?? ""]: !!props.class }}>
      <Show
        when={flat().length > 0}
        fallback={
          <div data-slot="list-empty-state">
            <div data-slot="list-message">
              {props.emptyMessage ?? "No results"} for <span data-slot="list-filter">&quot;{filter()}&quot;</span>
            </div>
          </div>
        }
      >
        <For each={grouped()}>
          {(group) => (
            <div data-slot="list-group">
              <Show when={group.category}>
                <div data-slot="list-header">{group.category}</div>
              </Show>
              <div data-slot="list-items">
                <For each={group.items}>
                  {(item, i) => (
                    <button
                      data-slot="list-item"
                      data-key={props.key(item)}
                      data-active={props.key(item) === active()}
                      data-selected={item === props.current}
                      onClick={() => handleSelect(item, i())}
                      onMouseMove={() => {
                        setStore("mouseActive", true)
                        setActive(props.key(item))
                      }}
                    >
                      {props.children(item)}
                      <Show when={item === props.current}>
                        <Icon data-slot="list-item-selected-icon" name="check-small" />
                      </Show>
                      <Show when={props.activeIcon}>
                        {(icon) => <Icon data-slot="list-item-active-icon" name={icon()} />}
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
