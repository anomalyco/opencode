import { useStorage, type Storage } from "../context/storage"
import { parsePromptInfo, type PromptInfo } from "./history"

export type PromptDraft = { prompt: PromptInfo; cursor: number }

type StoredDraft = PromptDraft & { savedAt: number }

type PersistedState = {
  projects: Record<string, Record<string, StoredDraft>>
}

// Every save rewrites the whole document, so keep it bounded instead of accumulating
// drafts for sessions that were abandoned long ago.
export const MAX_DRAFTS_PER_PROJECT = 20

/**
 * The unsent composer of each tab, kept on disk so it outlives the process. Tabs are
 * keyed by session ID, or "home" for the new-session composer, inside the directory the
 * TUI started in: a home draft belongs to the project it was typed for.
 *
 * component/prompt/draft-stash.ts covers the cheaper case of a remounting Prompt within
 * one process; this is what is left to restore after a crash or a killed process.
 */
export function createPromptDrafts(storage: Storage) {
  const [state, update] = storage.store<PersistedState>("prompt-drafts", { initial: { projects: {} } })

  return {
    read(project: string, tab: string) {
      return parseDraft(state.projects[project]?.[tab])
    },
    write(project: string, tab: string, draft: PromptDraft | undefined) {
      const stored = state.projects[project]?.[tab]
      if (unchanged(stored, draft)) return Promise.resolve()
      return update((next) => {
        const tabs = (next.projects[project] ??= {})
        if (!draft) {
          delete tabs[tab]
          return
        }
        tabs[tab] = { ...draft, savedAt: Date.now() }
        next.projects[project] = newest(tabs)
      }).catch((error) => console.error("Failed to persist prompt draft", error))
    },
  }
}

export function usePromptDrafts() {
  return createPromptDrafts(useStorage())
}

function unchanged(stored: StoredDraft | undefined, draft: PromptDraft | undefined) {
  if (!stored || !draft) return stored === draft
  return stored.cursor === draft.cursor && JSON.stringify(stored.prompt) === JSON.stringify(draft.prompt)
}

function newest(tabs: Record<string, StoredDraft>) {
  return Object.fromEntries(
    Object.entries(tabs)
      .toSorted((a, b) => b[1].savedAt - a[1].savedAt)
      .slice(0, MAX_DRAFTS_PER_PROJECT),
  )
}

// Storage hands back parsed JSON without validating it, so a truncated or hand-edited
// document must not reach the textarea as a malformed prompt.
function parseDraft(value: StoredDraft | undefined) {
  if (!value) return
  const prompt = parsePromptInfo(value.prompt)
  if (!prompt?.text) return
  return { prompt, cursor: typeof value.cursor === "number" ? value.cursor : prompt.text.length }
}
