import type { PromptInfo } from "../../prompt/history"

// Holds one in-progress draft per slot across Prompt remounts. The undefined
// key is the default single global slot that follows focus across tabs; the
// tab_drafts experiment keys drafts by the tab (sessionID or "home") they
// were written in. A draft is consumed on take: restoring it moves it out of
// the stash, so a stale copy never shadows newer input.
export type DraftEntry = { prompt: PromptInfo; cursor: number }

let global: DraftEntry | undefined
const byTab = new Map<string, DraftEntry>()

export function takeDraft(key: string | undefined) {
  if (key === undefined) {
    const entry = global
    global = undefined
    return entry
  }
  const entry = byTab.get(key)
  byTab.delete(key)
  return entry
}

export function saveDraft(key: string | undefined, entry: DraftEntry) {
  if (key === undefined) {
    global = entry
    return
  }
  byTab.set(key, entry)
}
