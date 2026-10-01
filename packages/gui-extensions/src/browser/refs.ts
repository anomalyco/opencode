import { Schema } from "effect"
import type { MainStorage } from "../sdk/main"

// Reserving in blocks keeps storage writes rare while refs stay short.
const block = 10_000

/**
 * Element refs for every page of the pane. A composer chip or an agent's message can still name a ref from
 * before the pane's main entry reloaded, so a new pane starts past every ref the previous one could hand out.
 */
export function createRefs(storage: MainStorage) {
  const reserved = storage.store("refs", { schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), initial: 0 })
  const state = { next: reserved.get(), end: reserved.get() }
  return () => {
    if (state.next >= state.end) {
      state.end = state.next + block
      reserved.set(state.end)
    }
    return `e${++state.next}`
  }
}
