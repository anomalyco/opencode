import { createStore } from "solid-js/store"
import type { ComposerStore, TimelineQuoteSource } from "./schema"

/** App-only source coordinates, persisted with drafts but never included in requests. */
export type QuoteSource = TimelineQuoteSource

export function createComposerQuoteSource(draft?: {
  get: () => ComposerStore["quoteSources"]
  set: (key: string, source: QuoteSource | undefined) => void
}) {
  const [sources, setSources] = createStore<Record<string, QuoteSource | undefined>>({})

  const [state, setState] = createStore<{
    sources: Record<string, QuoteSource | undefined>
    /** The quote whose open comment editor keeps its source highlighted. */
    pending?: string
  }>({
    get sources() {
      return draft?.get() ?? sources
    },
  })

  const setSource = (key: string, source: QuoteSource | undefined) =>
    draft ? draft.set(key, source) : setSources(key, source)

  return {
    state,
    add: (key: string, source: QuoteSource) => setSource(key, source),
    pend: (key: string) => setState("pending", key),
    settle: () => setState("pending", undefined),
    retain: (keys: string[]) => {
      Object.keys(state.sources).forEach((key) => {
        if (!keys.includes(key)) setSource(key, undefined)
      })

      if (state.pending && !keys.includes(state.pending)) setState("pending", undefined)
    },
  }
}
