import { Schema } from "effect"
import type { Persisted } from "@opencode/plugin/gui/main"

/** Main storage's `refs` store: the end of the last block of refs main reserved, so refs stay unique across reloads. */
export const RefsStore = { schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), initial: 0 }

// Reserving in blocks keeps storage writes rare while refs stay short.
const block = 10_000

/**
 * Element refs for every page of the pane. A composer chip or an agent's message can still name a ref from
 * before the pane's main entry reloaded, so a new pane starts past every ref the previous one could hand out.
 */
export function createRefs(reserved: Persisted<number, number>) {
  const state = { next: reserved.value, end: reserved.value }

  return () => {
    if (state.next >= state.end) {
      state.end = state.next + block
      reserved.set(state.end)
    }

    return `e${++state.next}`
  }
}
