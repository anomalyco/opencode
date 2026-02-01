import { type FilteredListProps, useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, createSignal, For, onCleanup, type JSX, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useI18n } from "../context/i18n"
import { Icon, type IconProps } from "./icon"
import { IconButton } from "./icon-button"
import { TextField } from "./text-field"

function findByKey(container: HTMLElement, key: string) {
  const nodes = container.querySelectorAll<HTMLElement>('[data-slot="list-item"][data-key]')
  for (const node of nodes) {
    if (node.getAttribute("data-key") === key) return node
  }
}

export interface ListSearchProps {
  placeholder?: string
  autofocus?: boolean
  hideIcon?: boolean
  class?: string
  action?: JSX.Element
}

export interface ListAddProps {
  class?: string
  render: () => JSX.Element
}

export interface ListAddProps {
  class?: string
  render: () => JSX.Element
}

export interface ListProps<T> extends FilteredListProps<T> {
  class?: string
  children: (item: T) => JSX.Element
  emptyMessage?: string
  loadingMessage?: string
  onKeyEvent?: (event: KeyboardEvent, item: T | undefined) => void
  onMove?: (item: T | undefined) => void
  onFilter?: (value: string) => void
  activeIcon?: IconProps["name"]
  filter?: string
  search?: ListSearchProps | boolean
  itemWrapper?: (item: T, node: JSX.Element) => JSX.Element
  divider?: boolean
  add?: ListAddProps
}

export interface ListRef {
  onKeyDown: (e: KeyboardEvent) => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
}

export function List<T>(props: ListProps<T> & { ref?: (ref: ListRef) => void }) {
  const i18n = useI18n()
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement | undefined>(undefined)
  const [internalFilter, setInternalFilter] = createSignal("")
  const [store, setStore] = createStore({
    mouseActive: false,
  })

  const scrollIntoView = (container: HTMLDivElement, node: HTMLElement, block: "center" | "nearest") => {
    const containerRect = container.getBoundingClientRect()
    const nodeRect = node.getBoundingClientRect()
    const top = nodeRect.top - containerRect.top + container.scrollTop
    const bottom = top + nodeRect.height
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    const target =
      block === "center"
        ? top - container.clientHeight / 2 + nodeRect.height / 2
        : top < viewTop
          ? top
          : bottom > viewBottom
            ? bottom - container.clientHeight
            : viewTop
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTop = Math.max(0, Math.min(target, max))
  }

  const { filter, grouped, flat, active, setActive, onKeyDown, onInput } = useFilteredList<T>(props)

  const searchProps = () => (typeof props.search === "object" ? props.search : {})
  const searchAction = () => searchProps().action
  const addProps = () => props.add
  const showAdd = () => !!addProps()

  const moved = (event: MouseEvent) => event.movementX !== 0 || event.movementY !== 0

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
      props.onFilter?.(current)
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
    const scroll = scrollRef()
    if (!scroll) return
    if (!props.current) return
    const key = props.key(props.current)
    requestAnimationFrame(() => {
      const element = findByKey(scroll, key)
      if (!element) return
      scrollIntoView(scroll, element, "center")
    })
  })

  createEffect(() => {
    const all = flat()
    if (store.mouseActive || all.length === 0) return
    const scroll = scrollRef()
    if (!scroll) return
    if (active() === props.key(all[0])) {
      scroll.scrollTo(0, 0)
      return
    }
    const key = active()
    if (!key) return
    const element = findByKey(scroll, key)
    if (!element) return
    scrollIntoView(scroll, element, "center")
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

    if (e.key === "Enter" && !e.isComposing) {
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

  const renderAdd = () => {
    const add = addProps()
    if (!add) return null
    return (
      <div data-slot="list-item-add" classList={{ [add.class ?? ""]: !!add.class }}>
        {add.render()}
      </div>
    )
  }

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

  const emptyMessage = () => {
    if (grouped.loading) return props.loadingMessage ?? i18n.t("ui.list.loading")
    if (props.emptyMessage) return props.emptyMessage

    const query = filter()
    if (!query) return i18n.t("ui.list.empty")

    const suffix = i18n.t("ui.list.emptyWithFilter.suffix")
    return (
      <>
        <span>{i18n.t("ui.list.emptyWithFilter.prefix")}</span>
        <span data-slot="list-filter">&quot;{query}&quot;</span>
        <Show when={suffix}>
          <span>{suffix}</span>
        </Show>
      </>
    )
  }

  return (
    <div data-component="list" classList={{ [props.class ?? ""]: !!props.class }}>
      <Show when={!!props.search}>
        <div data-slot="list-search-wrapper">
          <div data-slot="list-search" classList={{ [searchProps().class ?? ""]: !!searchProps().class }}>
            <div data-slot="list-search-container">
              <Show when={!searchProps().hideIcon}>
                <Icon name="magnifying-glass" />
              </Show>
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
              <IconButton
                icon="circle-x"
                variant="ghost"
                onClick={() => setInternalFilter("")}
                aria-label={i18n.t("ui.list.clearFilter")}
              />
            </Show>
          </div>
          {searchAction()}
        </div>
      </Show>
      <div ref={setScrollRef} data-slot="list-scroll">
        <Show
          when={flat().length > 0 || showAdd()}
          fallback={
            <div data-slot="list-empty-state">
              <div data-slot="list-message">{emptyMessage()}</div>
            </div>
          }
        >
          <For each={grouped.latest}>
            {(group, groupIndex) => {
              const isLastGroup = () => groupIndex() === grouped.latest.length - 1
              return (
                <div data-slot="list-group">
                  <Show when={group.category}>
                    <GroupHeader category={group.category} />
                  </Show>
                  <div data-slot="list-items">
                    <For each={group.items}>
                      {(item, i) => {
                        const node = (
                          <button
                            data-slot="list-item"
                            data-key={props.key(item)}
                            data-active={props.key(item) === active()}
                            data-selected={item === props.current}
                            onClick={() => handleSelect(item, i())}
                            type="button"
                            onMouseMove={(event) => {
                              if (!moved(event)) return
                              setStore("mouseActive", true)
                              setActive(props.key(item))
                            }}
                            onMouseLeave={() => {
                              if (!store.mouseActive) return
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
                            {props.divider && (i() !== group.items.length - 1 || (showAdd() && isLastGroup())) && (
                              <span data-slot="list-item-divider" />
                            )}
                          </button>
                        )
                        if (props.itemWrapper) return props.itemWrapper(item, node)
                        return node
                      }}
                    </For>
                    <Show when={showAdd() && isLastGroup()}>{renderAdd()}</Show>
                  </div>
                </div>
              )
            }}
          </For>
          <Show when={grouped.latest.length === 0 && showAdd()}>
            <div data-slot="list-group">
              <div data-slot="list-items">{renderAdd()}</div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
