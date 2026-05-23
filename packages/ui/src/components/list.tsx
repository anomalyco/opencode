import { type FilteredListProps, useFilteredList, useScrollContainer } from "@opencode-ai/ui/hooks"
import { createEffect, createMemo, For, type JSX, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { type VirtualizerHandle, Virtualizer } from "virtua/solid"
import { useI18n } from "../context/i18n"
import { Icon, type IconProps } from "./icon"
import { IconButton } from "./icon-button"
import { TextField } from "./text-field"

function log(_kind: string, _fields: Record<string, string | number | boolean | undefined>) {
}

/**
 * List component for displaying filterable, searchable, and keyboard-navigable lists.
 * 
 * Architecture:
 * - Uses `useScrollContainer` hook for scroll operations (scrollToElement, scrollToTop, findByKey)
 * - Uses `useFilteredList` hook for data filtering and keyboard navigation
 * - Scroll container uses native scrollbar with CSS customization (not ScrollView component)
 * - ScrollView component is for custom thumb-based scrollbars (used in session-review)
 * 
 * Naming:
 * - `data-slot="list-viewport"` is the scrollable container (renamed from "list-scroll")
 * - Not to be confused with ScrollView's `data-slot="scroll-view-viewport"`
 */

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
  style?: JSX.CSSProperties
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
  groupHeader?: (group: { category: string; items: T[] }) => JSX.Element
  virtual?: boolean
}

export interface ListRef {
  onKeyDown: (e: KeyboardEvent) => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  setFilter: (value: string) => void
}

export function List<T>(props: ListProps<T> & { ref?: (ref: ListRef) => void }) {
  const i18n = useI18n()
  let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined
  const [store, setStore] = createStore({
    mouseActive: false,
    internalFilter: "",
  })
  const internalFilter = () => store.internalFilter
  const setInternalFilter = (value: string) => setStore("internalFilter", value)

  const { setScrollRef, scrollRef, scrollToTop } = useScrollContainer()
  let virtualizerHandle: VirtualizerHandle | undefined

  const { filter, grouped, flat, active, setActive, onKeyDown, onInput, refetch } = useFilteredList<T>(props)

  const searchProps = () => (typeof props.search === "object" ? props.search : {})
  const searchAction = () => searchProps().action
  const addProps = () => props.add
  const showAdd = () => !!addProps()

  const moved = (event: MouseEvent) => event.movementX !== 0 || event.movementY !== 0

  const applyFilter = (value: string, options?: { ref?: boolean }) => {
    const prev = filter()
    setInternalFilter(value)
    onInput(value)
    props.onFilter?.(value)

    if (!options?.ref) return

    // Force a refetch even if the value is unchanged.
    // This is important for programmatic changes like Tab completion.
    if (prev === value) {
      refetch()
      return
    }
    queueMicrotask(() => refetch())
  }

  createEffect(() => {
    if (props.filter === undefined) return
    if (props.filter === internalFilter()) return
    setInternalFilter(props.filter)
    onInput(props.filter)
  })

  createEffect(
    on(
      filter,
      () => {
        scrollToTop("auto")
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!props.current) return
    const key = props.key(props.current)
    const rows = virtualRows()
    const idx = rows.findIndex((r) => r.type === "item" && props.key(r.item) === key)
    if (idx === -1) return
    requestAnimationFrame(() => {
      virtualizerHandle?.scrollToIndex(idx, { align: "center" })
    })
  })

  createEffect(() => {
    const all = flat()
    if (store.mouseActive || all.length === 0) return
    if (active() === props.key(all[0])) {
      scrollToTop("auto")
      return
    }
    const key = active()
    if (!key) return
    const rows = virtualRows()
    const idx = rows.findIndex((r) => r.type === "item" && props.key(r.item) === key)
    if (idx === -1) return
    virtualizerHandle?.scrollToIndex(idx, { align: "nearest" })
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

    if (e.defaultPrevented) return

    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault()
      if (selected) handleSelect(selected, index)
    } else if (props.search) {
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "n" || e.key === "p")) {
        onKeyDown(e)
        return
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        onKeyDown(e)
      }
    } else {
      onKeyDown(e)
    }
  }

  props.ref?.({
    onKeyDown: handleKey,
    setScrollRef,
    setFilter: (value) => applyFilter(value, { ref: true }),
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

  type VirtualRow =
    | { type: "header"; category: string; group: { category: string; items: T[] } }
    | { type: "item"; item: T; flatIndex: number; isLastInGroup: boolean; isLastGroup: boolean }
    | { type: "add" }

  const virtualRows = createMemo<VirtualRow[]>(() => {
    const groups = grouped.latest || []
    const rows: VirtualRow[] = []
    let flatIndex = 0
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]
      const isLastGroup = gi === groups.length - 1
      if (group.category) {
        rows.push({ type: "header", category: group.category, group })
      }
      for (let ii = 0; ii < group.items.length; ii++) {
        rows.push({
          type: "item",
          item: group.items[ii],
          flatIndex: flatIndex++,
          isLastInGroup: ii === group.items.length - 1,
          isLastGroup,
        })
      }
    }
    if (showAdd()) {
      rows.push({ type: "add" })
    }
    return rows
  })

  createEffect(() => {
    const rows = virtualRows()
    const items = rows.filter((row) => row.type === "item").length
    const headers = rows.filter((row) => row.type === "header").length
    log("rows", {
      rows: rows.length,
      items,
      headers,
      groups: grouped.latest?.length ?? 0,
      flat: flat().length,
      filter: filter(),
      loading: grouped.loading,
    })
  })

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

  const rowNode = (row: VirtualRow) => {
    if (row.type === "header") {
      return <div data-slot="list-header">{props.groupHeader?.(row.group) ?? row.category}</div>
    }
    if (row.type === "add") return renderAdd()
    const { item, flatIndex, isLastInGroup, isLastGroup } = row
    const node = (
      <button
        data-slot="list-item"
        data-key={props.key(item)}
        data-active={props.key(item) === active()}
        data-selected={item === props.current}
        onClick={() => handleSelect(item, flatIndex)}
        onKeyDown={handleKey}
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
        {props.divider && (!isLastInGroup || (showAdd() && isLastGroup)) && <span data-slot="list-item-divider" />}
      </button>
    )
    if (props.itemWrapper) return props.itemWrapper(item, node)
    return node
  }

  return (
    <div data-component="list" classList={{ [props.class ?? ""]: !!props.class }} style={props.style}>
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
                value={internalFilter()}
                onChange={(value) => applyFilter(value)}
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
                onClick={() => {
                  setInternalFilter("")
                  queueMicrotask(() => inputRef?.focus())
                }}
                aria-label={i18n.t("ui.list.clearFilter")}
              />
            </Show>
          </div>
          {searchAction()}
        </div>
      </Show>
      <div ref={setScrollRef} data-slot="list-viewport">
        <Show
          when={flat().length > 0 || showAdd()}
          fallback={
            <div data-slot="list-empty-state">
              <div data-slot="list-message">{emptyMessage()}</div>
            </div>
          }
        >
          <Show
            when={props.virtual !== false}
            fallback={
              <For each={virtualRows()}>
                {(row) => rowNode(row)}
              </For>
            }
          >
            <Virtualizer data={virtualRows()} scrollRef={scrollRef()} ref={(h) => { virtualizerHandle = h }}>
              {(row) => rowNode(row)}
            </Virtualizer>
          </Show>
        </Show>
      </div>
    </div>
  )
}
