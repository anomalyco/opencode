import { createMemo, createResource, onCleanup } from "solid-js"
import { uniqueCommandPaletteEntries, type CommandPaletteEntry } from "./palette"

export function createCommandPaletteSearch(props: {
  query: () => string
  items: (query: string) => CommandPaletteEntry[]
  sources: ((query: string, signal: AbortSignal) => Promise<CommandPaletteEntry[]>)[]
}) {
  const query = createMemo(() => props.query().trim())
  const local = createMemo(() => props.items(query()))

  const sources = props.sources.map((load) => {
    let abort: AbortController | undefined
    onCleanup(() => abort?.abort())

    const [result] = createResource(
      query,
      async (query) => {
        abort?.abort()
        const current = new AbortController()
        abort = current

        return load(query, current.signal).then(
          (items) => ({ query, items, failed: false }),
          () => ({ query, items: [], failed: true }),
        )
      },
      // Remote searches must not suspend the dialog's local results on first render.
      { initialValue: { query: "", items: [], failed: false } },
    )

    return result
  })

  return {
    items: createMemo(() => {
      const entries = uniqueCommandPaletteEntries([
        ...local(),
        ...sources.flatMap((source) => {
          // Never keep results for an older query selectable while the next one loads.
          const result = source.latest

          return result.query === query() ? result.items : []
        }),
      ])

      if (!query()) return entries
      const order = { command: 0, session: 1, file: 2 }

      return entries.sort(
        (a, b) =>
          order[a.type] - order[b.type] ||
          (a.type === "session" && b.type === "session" ? (b.updated ?? 0) - (a.updated ?? 0) : 0),
      )
    }),
    loading: () => sources.some((source) => source.loading),
    failed: () => sources.some((source) => source.latest.query === query() && source.latest.failed),
  }
}
