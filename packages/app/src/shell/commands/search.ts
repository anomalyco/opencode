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
        return { query, items: await load(query, current.signal).catch(() => []) }
      },
      // Remote searches must not suspend the dialog's local results on first render.
      { initialValue: { query: "", items: [] as CommandPaletteEntry[] } },
    )
    return result
  })

  return {
    items: createMemo(() =>
      uniqueCommandPaletteEntries([
        ...local(),
        ...sources.flatMap((source) => {
          // Never keep results for an older query selectable while the next one loads.
          const result = source.latest
          return result.query === query() ? result.items : []
        }),
      ]),
    ),
    loading: () => sources.some((source) => source.loading),
  }
}
