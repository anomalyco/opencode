import fuzzysort from "fuzzysort"

export type ListGroup<T> = { category: string; items: T[] }

export type ListConfig<T> = {
  readonly key: (item: T) => string
  readonly filterKeys?: string[]
  readonly skipFilter?: (item: T) => boolean
  readonly groupBy?: (item: T) => string
  readonly sortBy?: (a: T, b: T) => number
  readonly sortGroupsBy?: (a: ListGroup<T>, b: ListGroup<T>) => number
}

/** The one copy of the query. A `controlled` list shows the parent's `filter` prop and only reports edits. */
export type ListFilter = { readonly type: "uncontrolled" | "controlled"; readonly query: string }

/** `mouse` while the pointer drives the highlight, so the list does not scroll under it. */
export type ListHighlight = { readonly mode: "keyboard" | "mouse"; readonly activeKey: string | null }

type ListData<T> = {
  readonly filter: ListFilter
  readonly groups: ListGroup<T>[]
  readonly rows: T[]
  readonly keys: string[]
  readonly highlight: ListHighlight
}

/** `loading` keeps the last rows on screen; `epoch` is the last attempt that settled. */
export type ListState<T> =
  | (ListData<T> & { readonly status: "ready"; readonly epoch: number })
  | (ListData<T> & { readonly status: "loading"; readonly attempt: number })

export type ListKeyDown = {
  readonly type: "key.down"
  readonly key: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly meta: boolean
  readonly shift: boolean
  readonly composing: boolean
  /** A search input keeps Home, End and Tab for the text field. */
  readonly search: boolean
  /** Escape, or a key the caller's `onKeyEvent` already handled. */
  readonly claimed: boolean
}

export type ListEvent<T> =
  | { readonly type: "query.change"; readonly value: string; readonly force?: boolean }
  | { readonly type: "filter.controlled"; readonly value: string }
  | { readonly type: "filter.uncontrolled" }
  | { readonly type: "items.reload" }
  | { readonly type: "load.resolved"; readonly attempt: number; readonly items: T[] }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "pointer.move"; readonly key: string; readonly moved: boolean }
  | { readonly type: "pointer.leave" }
  | { readonly type: "active.set"; readonly key: string | null }
  | { readonly type: "active.reset" }
  | ListKeyDown

export type ListEffect<T> =
  | { readonly type: "load"; readonly attempt: number; readonly query: string }
  | { readonly type: "notify.filter"; readonly value: string }
  | { readonly type: "select"; readonly item: T; readonly index: number }

export type ListTransition<T> = {
  readonly state: ListState<T>
  readonly effects: ListEffect<T>[]
  readonly handled: boolean
}

export function createListState<T>(filter?: string): ListState<T> {
  return {
    status: "ready",
    epoch: 0,
    filter: filter === undefined ? { type: "uncontrolled", query: "" } : { type: "controlled", query: filter },
    groups: [],
    rows: [],
    keys: [],
    highlight: { mode: "keyboard", activeKey: null },
  }
}

export function transitionList<T>(state: ListState<T>, event: ListEvent<T>, config: ListConfig<T>): ListTransition<T> {
  if (event.type === "query.change") return queryChanged(state, event.value, event.force === true)

  if (event.type === "filter.controlled") {
    if (event.value !== state.filter.query) return load(state, { type: "controlled", query: event.value })

    if (state.filter.type === "controlled") return unchanged(state)

    return changed({ ...state, filter: { type: "controlled", query: event.value } })
  }

  if (event.type === "filter.uncontrolled") {
    if (state.filter.type === "uncontrolled") return unchanged(state)

    return changed({ ...state, filter: { type: "uncontrolled", query: state.filter.query } })
  }

  if (event.type === "items.reload") return load(state, state.filter)

  if (event.type === "load.resolved" || event.type === "load.failed") {
    if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)
    const groups = event.type === "load.resolved" ? filterItems(event.items, state.filter.query, config) : []
    const rows = groups.flatMap((group) => group.items)
    const keys = rows.map(config.key)

    return changed({
      status: "ready",
      epoch: state.attempt,
      filter: state.filter,
      groups,
      rows,
      keys,
      // Each result set opens on its first row; `current` only marks the selected item.
      highlight: { mode: state.highlight.mode, activeKey: keys[0] ?? null },
    })
  }

  if (event.type === "pointer.move") {
    if (!event.moved || (state.highlight.mode === "mouse" && state.highlight.activeKey === event.key))
      return unchanged(state)

    return changed({ ...state, highlight: { mode: "mouse", activeKey: event.key } })
  }

  if (event.type === "pointer.leave") {
    if (state.highlight.mode === "keyboard" || state.highlight.activeKey === null) return unchanged(state)

    return changed({ ...state, highlight: { mode: "mouse", activeKey: null } })
  }

  if (event.type === "active.set") return highlight(state, event.key || null)

  if (event.type === "active.reset") return state.keys.length ? highlight(state, state.keys[0]) : unchanged(state)

  return keyDown(state, event)
}

/** The highlighted row and its index among all rows. */
export function listActive<T>(state: Pick<ListState<T>, "rows" | "keys" | "highlight">) {
  const index = state.highlight.activeKey === null ? -1 : state.keys.indexOf(state.highlight.activeKey)

  return index < 0 ? undefined : { item: state.rows[index], index }
}

/** Where the list scrolls to keep the keyboard highlight in view; the pointer never scrolls it. */
export function listScrollTarget<T>(
  state: Pick<ListState<T>, "keys" | "highlight">,
): { type: "none" } | { type: "top" } | { type: "item"; key: string } {
  const key = state.highlight.activeKey

  if (state.highlight.mode === "mouse" || key === null || state.keys.length === 0) return { type: "none" }

  if (key === state.keys[0]) return { type: "top" }

  return { type: "item", key }
}

export function groupItems<T>(items: T[], config: Pick<ListConfig<T>, "groupBy" | "sortBy" | "sortGroupsBy">) {
  // A plain object keeps the group order of `Object.entries`, where numeric-looking categories sort first.
  const byCategory: Record<string, T[]> = {}

  for (const item of items) {
    const category = config.groupBy ? config.groupBy(item) : ""
    byCategory[category] ??= []
    byCategory[category].push(item)
  }

  const groups = Object.entries(byCategory).map(([category, group]) => ({
    category,
    items: config.sortBy ? group.sort(config.sortBy) : group,
  }))

  return config.sortGroupsBy ? groups.sort(config.sortGroupsBy) : groups
}

function queryChanged<T>(state: ListState<T>, value: string, force: boolean): ListTransition<T> {
  const same = value === state.filter.query

  if (same && !force) return unchanged(state)
  const notify: ListEffect<T> = { type: "notify.filter", value }

  // A controlled list waits for the parent to pass the new `filter` back.
  if (state.filter.type === "controlled" && !same) return unchanged(state, [notify])
  const next = load(state, { type: state.filter.type, query: value })

  return { ...next, effects: [notify, ...next.effects] }
}

function load<T>(state: ListState<T>, filter: ListFilter): ListTransition<T> {
  const attempt = (state.status === "loading" ? state.attempt : state.epoch) + 1

  return changed(
    {
      status: "loading",
      attempt,
      filter,
      groups: state.groups,
      rows: state.rows,
      keys: state.keys,
      highlight: state.highlight,
    },
    [{ type: "load", attempt, query: filter.query }],
  )
}

function highlight<T>(state: ListState<T>, activeKey: string | null): ListTransition<T> {
  if (activeKey === state.highlight.activeKey) return unchanged(state)

  return changed({ ...state, highlight: { mode: state.highlight.mode, activeKey } })
}

function keyDown<T>(state: ListState<T>, event: ListKeyDown): ListTransition<T> {
  const next: ListState<T> =
    state.highlight.mode === "keyboard" ? state : { ...state, highlight: { ...state.highlight, mode: "keyboard" } }

  if (event.claimed) return changed(next)

  if (event.key === "Enter" && !event.composing) {
    const active = listActive(next)

    return changed(next, active ? [{ type: "select", item: active.item, index: active.index }] : [], true)
  }

  const move = navigate(event, next.keys, next.highlight.activeKey)

  if (!move) return changed(next)

  if (move.key === undefined) return changed(next, [], true)

  return changed({ ...next, highlight: { mode: "keyboard", activeKey: move.key } }, [], true)
}

function navigate(event: ListKeyDown, keys: string[], active: string | null): { key?: string } | undefined {
  const index = active === null ? -1 : keys.indexOf(active)

  if (event.ctrl && !event.meta && !event.alt && !event.shift) {
    if (event.key !== "n" && event.key !== "p") return

    return { key: step(keys, index, event.key === "n" ? 1 : -1) }
  }

  // Option+Arrow and Cmd+Arrow edit text on macOS.
  if (event.alt || event.meta || keys.length === 0) return

  if (event.key === "ArrowDown") return { key: step(keys, index, 1) }

  if (event.key === "ArrowUp") return { key: step(keys, index, -1) }

  if (event.search) return

  if (event.key === "Home") return { key: keys[0] }

  if (event.key === "End") return { key: keys[keys.length - 1] }

  if (event.key !== "Tab" || index < 0) return
  const next = index + (event.shift ? -1 : 1)

  if (next < 0 || next >= keys.length) return

  return { key: keys[next] }
}

function step(keys: string[], index: number, direction: 1 | -1) {
  if (keys.length === 0) return

  if (index < 0) return direction === 1 ? keys[0] : keys[keys.length - 1]

  return keys[(index + direction + keys.length) % keys.length]
}

function filterItems<T>(items: T[], query: string, config: ListConfig<T>) {
  const needle = query.toLowerCase()

  return groupItems(needle ? search(items, needle, config) : items, config)
}

function search<T>(all: T[], needle: string, config: ListConfig<T>) {
  const skipFilter = config.skipFilter
  const filterable = skipFilter ? all.filter((item) => !skipFilter(item)) : all
  const skipped = skipFilter ? all.filter(skipFilter) : []

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- plain string lists have no keys to search by
  const strings = !config.filterKeys && filterable.every((e) => typeof e === "string")

  // SAFETY: when `strings` holds, every element is a string, so the matched targets are the items.
  const filtered = strings
    ? (fuzzysort.go(needle, filterable as string[]).map((x) => x.target) as T[])
    : fuzzysort.go(needle, filterable, { keys: config.filterKeys! }).map((x) => x.obj)

  return skipped.length ? [...filtered, ...skipped] : filtered
}

function changed<T>(state: ListState<T>, effects: ListEffect<T>[] = [], handled = false): ListTransition<T> {
  return { state, effects, handled }
}

function unchanged<T>(state: ListState<T>, effects: ListEffect<T>[] = []): ListTransition<T> {
  return { state, effects, handled: false }
}
