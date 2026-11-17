import { Schema } from "effect"
import type { Persisted } from "@opencode/plugin/gui/main"

/** Main storage's `refs` store: the end of the last block of refs main reserved, so refs stay unique across reloads. */
export const RefsStore = { schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), initial: 0 }

/** Scoped reads add to this document's refs; a navigation discards both directions together. */
export function documentRefs() {
  const elements = new Map<string, { backendID: number; frameID: string; sessionID?: string }>()
  const frames = new Map<string, Map<number, string>>()
  const frame = (frameID: string, sessionID?: string) => `${sessionID ?? ""}:${frameID}`

  return {
    get: (ref: string) => elements.get(ref),
    previous: (frameID: string, sessionID?: string) =>
      frames.get(frame(frameID, sessionID)) ?? new Map<number, string>(),
    add(frameID: string, sessionID: string | undefined, refs: ReadonlyMap<string, number>) {
      if (!refs.size) return
      const key = frame(frameID, sessionID)
      const previous = frames.get(key) ?? new Map<number, string>()
      frames.set(key, previous)
      refs.forEach((backendID, ref) => {
        elements.set(ref, { frameID, sessionID, backendID })
        previous.set(backendID, ref)
      })

      while (elements.size > 10_000) {
        const oldest = elements.entries().next().value

        if (!oldest) break
        elements.delete(oldest[0])
        const source = frame(oldest[1].frameID, oldest[1].sessionID)
        const reverse = frames.get(source)

        if (reverse?.get(oldest[1].backendID) === oldest[0]) reverse.delete(oldest[1].backendID)

        if (!reverse?.size) frames.delete(source)
      }
    },
    clear() {
      elements.clear()
      frames.clear()
    },
  }
}

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
