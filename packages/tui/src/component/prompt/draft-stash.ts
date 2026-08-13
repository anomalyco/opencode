import type { PromptInfo } from "../../prompt/history"

// Holds one in-progress draft per tab across Prompt remounts. A draft is
// consumed on take: restoring it moves it out of the stash, so a stale copy
// never shadows newer input.
export type DraftEntry = { prompt: PromptInfo; cursor: number }

const byTab = new Map<string, DraftEntry>()

export function takeDraft(key: string) {
  const entry = byTab.get(key)
  byTab.delete(key)
  return entry
}

export function saveDraft(key: string, entry: DraftEntry) {
  byTab.set(key, entry)
}
