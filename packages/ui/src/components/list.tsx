import { type FilteredListProps, useFilteredList } from "@opencode/ui/hooks"
import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useI18n } from "../context/i18n"
import { listActive, listScrollTarget, selectListEmptyState } from "../hooks/list-machine"
import { Icon, type IconProps } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
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

export interface ListProps<T> extends FilteredListProps<T> {
  class?: string
  children: (item: T) => JSX.Element
  emptyMessage?: string
  loadingMessage?: string
  /** Shown when an async `items` loader rejects or times out. */
  errorMessage?: string
  onKeyEvent?: (event: KeyboardEvent, item: T | undefined) => void
  onMove?: (item: T | undefined) => void
  activeIcon?: IconProps["name"]
  search?: ListSearchProps | boolean
  itemWrapper?: (item: T, node: JSX.Element) => JSX.Element
  divider?: boolean
  add?: ListAddProps
  groupHeader?: (group: { category: string; items: T[] }) => JSX.Element
}

export interface ListRef {
  onKeyDown: (e: KeyboardEvent) => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  setFilter: (value: string) => void
}

export function List<T>(props: ListProps<T> & { ref?: (ref: ListRef) => void }) {
  const i18n = useI18n()
  let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined

  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>()

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

  const list = useFilteredList<T>(props)
  const keys = createMemo(() => list.state().keys)
  const highlight = createMemo(() => list.state().highlight)

  const searchProps = () => (props.search && props.search !== true ? props.search : {})
  const searchAction = () => searchProps().action
  const addProps = () => props.add
  const showAdd = () => !!addProps()

  createEffect(on(list.filter, () => scrollRef()?.scrollTo(0, 0), { defer: true }))

  createEffect(() => {
    const target = listScrollTarget({ keys: keys(), highlight: highlight() })
    const scroll = scrollRef()

    if (!scroll || target.type === "none") return

    if (target.type === "top") return scroll.scrollTo(0, 0)
    const element = findByKey(scroll, target.key)

    if (element) scrollIntoView(scroll, element, "center")
  })

  const activeItem = createMemo(() => listActive(list.state())?.item)

  createEffect(() => props.onMove?.(activeItem()))

  const handleKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") props.onKeyEvent?.(e, activeItem())
    list.onKeyDown(e, { search: !!props.search, claimed: e.key === "Escape" || e.defaultPrevented })
  }

  props.ref?.({
    onKeyDown: handleKey,
    setScrollRef,
    // Forces a reload even when the value is unchanged, for programmatic changes like Tab completion.
    setFilter: (value) => list.dispatch({ type: "query.change", value, force: true }),
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

  function GroupHeader(groupProps: { group: { category: string; items: T[] } }): JSX.Element {
    const [state, setState] = createStore<{ stuck: boolean; header?: HTMLDivElement }>({ stuck: false })

    createEffect(() => {
      const scroll = scrollRef()
      const node = state.header

      if (!scroll || !node) return

      const handler = () => {
        const rect = node.getBoundingClientRect()
        const scrollRect = scroll.getBoundingClientRect()
        setState("stuck", rect.top <= scrollRect.top + 1 && scroll.scrollTop > 0)
      }

      makeEventListener(scroll, "scroll", handler, { passive: true })
      handler()
    })

    return (
      <div data-slot="list-header" data-stuck={state.stuck} ref={(el) => setState("header", el)}>
        {props.groupHeader?.(groupProps.group) ?? groupProps.group.category}
      </div>
    )
  }

  const emptyMessage = () => {
    const empty = selectListEmptyState(list.state())

    if (empty.type === "loading") return props.loadingMessage ?? i18n.t("ui.list.loading")

    if (empty.type === "failed") return props.errorMessage ?? i18n.t("ui.list.failed")

    if (props.emptyMessage) return props.emptyMessage

    const query = empty.query

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
          <div
            data-slot="list-search"
            classList={{ [searchProps().class ?? ""]: !!searchProps().class }}
            onPointerDown={(event) => {
              const container = event.currentTarget

              if (!(container instanceof HTMLElement)) return

              const node = container.querySelector("input, textarea")
              const input = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node : inputRef
              input?.focus()

              // Prevent global listeners (e.g. dnd sensors) from cancelling focus.
              event.stopPropagation()
            }}
          >
            <div data-slot="list-search-container">
              <Show when={!searchProps().hideIcon}>
                <Icon name="magnifying-glass" />
              </Show>
              <TextField
                autofocus={searchProps().autofocus}
                variant="ghost"
                data-slot="list-search-input"
                type="text"
                ref={(el: HTMLInputElement | HTMLTextAreaElement) => {
                  inputRef = el
                }}
                value={list.filter()}
                onChange={(value) => list.onInput(value)}
                onKeyDown={handleKey}
                placeholder={searchProps().placeholder}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
              />
            </div>
            <Show when={list.filter()}>
              <IconButton
                icon={<Icon name="circle-x" />}
                variant="ghost"
                onClick={() => {
                  list.clear()
                  queueMicrotask(() => inputRef?.focus())
                }}
                aria-label={i18n.t("ui.list.clearFilter")}
              />
            </Show>
          </div>
          {searchAction()}
        </div>
      </Show>
      <div ref={setScrollRef} data-slot="list-scroll">
        <Show
          when={list.flat().length > 0 || showAdd()}
          fallback={
            <div data-slot="list-empty-state">
              <div data-slot="list-message">{emptyMessage()}</div>
            </div>
          }
        >
          <For each={list.grouped.latest}>
            {(group, groupIndex) => {
              const isLastGroup = () => groupIndex() === list.grouped.latest.length - 1

              return (
                <div data-slot="list-group">
                  <Show when={group.category}>
                    <GroupHeader group={group} />
                  </Show>
                  <div data-slot="list-items">
                    <For each={group.items}>
                      {(item, i) => {
                        const node = (
                          <button
                            data-slot="list-item"
                            data-key={props.key(item)}
                            data-active={props.key(item) === list.active()}
                            data-selected={item === props.current}
                            onClick={() => props.onSelect?.(item, i())}
                            onKeyDown={handleKey}
                            type="button"
                            onMouseMove={(event) =>
                              list.dispatch({
                                type: "pointer.move",
                                key: props.key(item),
                                moved: event.movementX !== 0 || event.movementY !== 0,
                              })
                            }
                            onMouseLeave={() => list.dispatch({ type: "pointer.leave" })}
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
                            <Show
                              when={props.divider && (i() !== group.items.length - 1 || (showAdd() && isLastGroup()))}
                            >
                              <span data-slot="list-item-divider" />
                            </Show>
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
          <Show when={list.grouped.latest.length === 0 && showAdd()}>
            <div data-slot="list-group">
              <div data-slot="list-items">{renderAdd()}</div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
