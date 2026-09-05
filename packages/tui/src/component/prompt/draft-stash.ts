import { createSignal } from "solid-js"
import { unwrap } from "solid-js/store"
import type { PromptInfo } from "../../prompt/history"

// Holds one in-progress draft per tab across Prompt remounts. A draft is
// consumed on take: restoring it moves it out of the stash, so a stale copy
// never shadows newer input.
export type DraftEntry = { prompt: PromptInfo; cursor: number }

const byTab = new Map<string | undefined, DraftEntry>()
const [failed, setFailed] = createSignal(new Map<string | undefined, DraftEntry[]>())

export function takeDraft(sessionID: string | undefined) {
  const entry = byTab.get(sessionID)
  byTab.delete(sessionID)
  return entry
}

export function saveDraft(sessionID: string | undefined, entry: DraftEntry) {
  byTab.set(sessionID, entry)
}

export function failedDrafts(sessionID: string | undefined) {
  return failed().get(sessionID) ?? []
}

export function saveFailedDraft(sessionID: string | undefined, entry: DraftEntry) {
  const snapshot = structuredClone(unwrap(entry))
  setFailed((current) => new Map(current).set(sessionID, [...(current.get(sessionID) ?? []), snapshot]))
}

export function takeFailedDraft(sessionID: string | undefined) {
  const entries = failedDrafts(sessionID)
  const entry = entries[0]
  if (!entry) return
  setFailed((current) => {
    const next = new Map(current)
    if (entries.length > 1) return next.set(sessionID, entries.slice(1))
    next.delete(sessionID)
    return next
  })
  return entry
}
