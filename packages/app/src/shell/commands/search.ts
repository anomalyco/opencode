import { createComputed, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { uniqueCommandPaletteEntries, type CommandPaletteEntry } from "./palette"
import {
  createPaletteSearchState,
  selectPaletteSearchFailed,
  selectPaletteSearchLoading,
  selectPaletteSearchSources,
  transitionPaletteSearch,
  type PaletteSearchEffect,
  type PaletteSearchEvent,
} from "./search-machine"

export function matchesCommandPaletteEntry(entry: CommandPaletteEntry, query: string) {
  const value = query.trim().toLowerCase()

  if (!value) return true

  // The server matches sessions by title, so their "Session" group name must not match every one of them here.
  const category = entry.type === "session" ? undefined : entry.category

  return [entry.title, entry.description, category, entry.keywords, entry.path, entry.sessionID].some((text) =>
    text?.toLowerCase().includes(value),
  )
}

const typeOrder = { command: 0, session: 1, setting: 2, file: 3 }

/** Search results: commands lead, then sessions (those open as tabs first, then the newest), settings and files. */
export function rankCommandPaletteEntries(
  entries: CommandPaletteEntry[],
  open: (entry: CommandPaletteEntry) => boolean,
) {
  return entries.toSorted(
    (a, b) =>
      typeOrder[a.type] - typeOrder[b.type] ||
      (a.type === "session" && b.type === "session"
        ? Number(open(b)) - Number(open(a)) || (b.updated ?? 0) - (a.updated ?? 0)
        : 0),
  )
}

export function createCommandPaletteSearch(props: {
  query: () => string
  items: (query: string) => CommandPaletteEntry[]
  sources: ((query: string, signal: AbortSignal) => Promise<CommandPaletteEntry[]>)[]
  /** Sessions open as tabs, which lead the matching sessions. */
  open?: (entry: CommandPaletteEntry) => boolean
}) {
  const query = createMemo(() => props.query().trim())
  const local = createMemo(() => props.items(query()))
  const [searchState, setSearchState] = createSignal(createPaletteSearchState(props.sources.length))
  const inflight = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const dispatch = (event: PaletteSearchEvent) =>
    untrack(() => {
      const previous = searchState()
      const next = transitionPaletteSearch(previous, event)

      if (next.state !== previous) setSearchState(next.state)
      next.effects.forEach(run)
    })

  function run(effect: PaletteSearchEffect) {
    if (effect.type === "source.abort") {
      const current = inflight.get(effect.attempt)
      clearTimeout(current?.timer)
      current?.controller.abort()
      inflight.delete(effect.attempt)

      return
    }

    const attempt = effect.attempt
    const index = effect.index
    const controller = new AbortController()

    inflight.set(attempt, {
      controller,
      timer: setTimeout(() => dispatch({ type: "source.timed-out", index, attempt }), effect.timeoutMs),
    })

    const settle = (event: PaletteSearchEvent) => {
      clearTimeout(inflight.get(attempt)?.timer)
      inflight.delete(attempt)

      // An aborted attempt was superseded or timed out, and the machine already left it.
      if (!controller.signal.aborted) dispatch(event)
    }

    void Promise.try(() => props.sources[index]!(effect.query, controller.signal)).then(
      (items) => settle({ type: "source.resolved", index, attempt, items }),
      () => settle({ type: "source.failed", index, attempt }),
    )
  }

  // A computed, not an effect: the first search starts on creation, and a new query aborts the previous search at once.
  createComputed(() => {
    const current = query()
    dispatch({ type: "query.changed", query: current })
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  const items = createMemo<CommandPaletteEntry[]>(() => {
    const current = query()

    const entries = uniqueCommandPaletteEntries([
      ...local(),
      ...selectPaletteSearchSources(searchState()).flatMap((source) => {
        const result = source.settled

        if (result.query === current) return result.items

        if (!current) return []

        const matched = uniqueCommandPaletteEntries([...result.items, ...source.seen]).filter((item) =>
          matchesCommandPaletteEntry(item, current),
        )

        if (matched.length > 0) return matched

        return result.query && current.toLowerCase().startsWith(result.query.toLowerCase()) ? result.items : []
      }),
    ])

    if (!current) return entries

    return rankCommandPaletteEntries(entries, props.open ?? (() => false))
  })

  return {
    items,
    loading: () => selectPaletteSearchLoading(searchState()),
    failed: () => selectPaletteSearchFailed(searchState()),
  }
}
