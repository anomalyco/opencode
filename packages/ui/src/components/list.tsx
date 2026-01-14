import { type FilteredListProps, useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, createSignal, For, onCleanup, type JSX, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon, type IconProps } from "./icon"
import { IconButton } from "./icon-button"
import { TextField } from "./text-field"

export interface ListSearchProps {
  placeholder?: string
  autofocus?: boolean
}

export interface ListProps<T> extends FilteredListProps<T> {
  class?: string
  children: (item: T) => JSX.Element
  emptyMessage?: string
  onKeyEvent?: (event: KeyboardEvent, item: T | undefined) => void
  onMove?: (item: T | undefined) => void
  activeIcon?: IconProps["name"]
  filter?: string
  search?: ListSearchProps | boolean
}

export interface ListRef {
  onKeyDown: (e: KeyboardEvent) => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
}

export function List<T>(props: ListProps<T> & { ref?: (ref: ListRef) => void }) {
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement | undefined>(undefined)
  const [internalFilter, setInternalFilter] = createSignal("")
  const [store, setStore] = createStore({
    mouseActive: false,
  })

  const { filter, grouped, flat, active, setActive, onKeyDown, onInput } = useFilteredList<T>(props)

  const searchProps = () => (typeof props.search === "object" ? props.search : {})

  createEffect(() => {
    if (props.filter !== undefined) {
      onInput(props.filter)
    }
  })

  createEffect((prev) => {
    if (!props.search) return
    const current = internalFilter()
    if (prev !== current) {
      onInput(current)
    }
    return current
  }, "")

  createEffect(
    on(
      filter,
      () => {
        scrollRef()?.scrollTo(0, 0)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!scrollRef()) return
    if (!props.current) return
    const key = props.key(props.current)
    requestAnimationFrame(() => {
      const element = scrollRef()?.querySelector(`[data-key="${key}"]`)
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
    element?.scrollIntoView({ block: "center", behavior: "smooth" })
  })

  createEffect(() => {
    const all = flat()
    const current = active()
    const item = all.find((x) => props.key(x) === current)
    props.onMove?.(item)
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

  function GroupHeader(groupProps: { category: string }): JSX.Element {
    const [stuck, setStuck] = createSignal(false)
    const [header, setHeader] = createSignal<HTMLDivElement | undefined>(undefined)

    createEffect(() => {
      const scroll = scrollRef()
      const node = header()
      if (!scroll || !node) return

      const handler = () => {
        const rect = node.getBoundingClientRect()
        const scrollRect = scroll.getBoundingClientRect()
        setStuck(rect.top <= scrollRect.top + 1 && scroll.scrollTop > 0)
      }

      scroll.addEventListener("scroll", handler, { passive: true })
      handler()
      onCleanup(() => scroll.removeEventListener("scroll", handler))
    })

    return (
      <div data-slot="list-header" data-stuck={stuck()} ref={setHeader}>
        {groupProps.category}
      </div>
    )
  }

  return (
    <div data-component="list" classList={{ [props.class ?? ""]: !!props.class }}>
      <Show when={!!props.search}>
        <div data-slot="list-search">
          <div data-slot="list-search-container">
            <Icon name="magnifying-glass" />
            <TextField
              autofocus={searchProps().autofocus}
              variant="ghost"
              data-slot="list-search-input"
              type="text"
              value={internalFilter()}
              onChange={setInternalFilter}
              onKeyDown={handleKey}
              placeholder={searchProps().placeholder}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
            />
          </div>
          <Show when={internalFilter()}>
            <IconButton icon="circle-x" variant="ghost" onClick={() => setInternalFilter("")} />
          </Show>
        </div>
      </Show>
      <div ref={setScrollRef} data-slot="list-scroll">
        <Show
          when={flat().length > 0}
          fallback={
            <div data-slot="list-empty-state">
              <div data-slot="list-message">
                {props.emptyMessage ?? (grouped.loading ? "Loading" : "No results")} for{" "}
                <span data-slot="list-filter">&quot;{filter()}&quot;</span>
              </div>
            </div>
          }
        >
          <For each={grouped.latest}>
            {(group) => (
              <div data-slot="list-group">
                <Show when={group.category}>
                  <GroupHeader category={group.category} />
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
                        type="button"
                        onMouseMove={() => {
                          setStore("mouseActive", true)
                          setActive(props.key(item))
                        }}
                        onMouseLeave={() => {
                          setActive(null)
                        }}
                      >
                        {props.children(item)}
                        <Show when={item === props.current}>
                          <span data-slot="list-item-selected-icon">
                            <Icon name="check-small" />
                          </span>
                        </Show>
                        <Show when={props.activeIcon}>
                          {(icon) => (
                            <span data-slot="list-item-active-icon">
                              <Icon name={icon()} />
                            </span>
                          )}
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
    </div>
  )
}
