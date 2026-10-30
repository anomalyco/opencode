import { abort } from "@opencode/util/abort"
import { createMemo, createResource, onCleanup } from "solid-js"
import { uniqueCommandPaletteEntries, type CommandPaletteEntry } from "./palette"

type SourceResult = {
  query: string
  items: CommandPaletteEntry[]
  failed: boolean
}

type SourceState = {
  abort?: AbortController
  seen: CommandPaletteEntry[]
}

const emptyResult: SourceResult = { query: "", items: [], failed: false }

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

  const sources = props.sources.map((load) => {
    const state: SourceState = { seen: [] }
    onCleanup(() => abort(state.abort))

    const [result] = createResource<SourceResult, string>(
      query,
      async (query, info) => {
        abort(state.abort)
        const current = new AbortController()
        state.abort = current
        const previous = info.value ?? emptyResult

        return load(query, current.signal).then(
          (items) => {
            if (current.signal.aborted) return previous

            if (query && items.length > 0) {
              state.seen = uniqueCommandPaletteEntries([...items, ...state.seen])
            }

            return { query, items, failed: false }
          },
          () => (current.signal.aborted ? previous : { query, items: [], failed: true }),
        )
      },
      // Remote searches must not suspend the dialog's local results on first render.
      { initialValue: emptyResult },
    )

    return { result, state }
  })

  const loading = () => sources.some((source) => source.result.loading)

  const items = createMemo<CommandPaletteEntry[]>(() => {
    const current = query()

    const entries = uniqueCommandPaletteEntries([
      ...local(),
      ...sources.flatMap((source) => {
        const result =
          source.result.state === "ready" || source.result.state === "refreshing" ? source.result.latest : emptyResult

        if (result.query === current) return result.items

        if (!current) return []

        const matched = uniqueCommandPaletteEntries([...result.items, ...source.state.seen]).filter((item) =>
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
    loading,
    failed: () =>
      sources.some((source) => {
        const result =
          source.result.state === "ready" || source.result.state === "refreshing" ? source.result.latest : emptyResult

        return result.query === query() && result.failed
      }),
  }
}
