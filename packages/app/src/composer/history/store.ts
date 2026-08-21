import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import type { Prompt } from "@/composer/state"
import { Persist, persisted } from "@/runtime/persistence/storage"
import {
  clonePromptHistoryComments,
  clonePromptParts,
  prependHistoryEntry,
  type PromptHistoryComment,
  type PromptHistoryStoredEntry,
} from "./entry"

export type ComposerHistoryStore = {
  entries: (mode: "normal" | "shell") => PromptHistoryStoredEntry[]
  add: (prompt: Prompt, mode: "normal" | "shell", comments: PromptHistoryComment[]) => void
}

type PromptHistoryState = { entries: PromptHistoryStoredEntry[] }

export function upgradeHistoryState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("entries" in value)) return value
  const entries = value.entries
  if (!Array.isArray(entries)) return value
  return {
    ...value,
    entries: entries.flatMap((entry): PromptHistoryStoredEntry[] => {
      if (Array.isArray(entry)) return [{ prompt: clonePromptParts(entry as Prompt), comments: [] }]
      if (!entry || typeof entry !== "object" || !("prompt" in entry) || !Array.isArray(entry.prompt)) return []
      if (!("comments" in entry) || !Array.isArray(entry.comments)) return []
      return [entry as PromptHistoryStoredEntry]
    }),
  }
}

function createComposerHistoryStore(
  normal: Store<PromptHistoryState>,
  setNormal: SetStoreFunction<PromptHistoryState>,
  shell: Store<PromptHistoryState>,
  setShell: SetStoreFunction<PromptHistoryState>,
): ComposerHistoryStore {
  return {
    entries: (mode) => (mode === "shell" ? shell.entries : normal.entries),
    add(prompt, mode, comments) {
      const current = mode === "shell" ? shell : normal
      const setCurrent = mode === "shell" ? setShell : setNormal
      const next = prependHistoryEntry(current.entries, prompt, comments)
      if (next === current.entries) return
      setCurrent("entries", next)
    },
  }
}

export function createComposerHistory() {
  const [normal, setNormal, normalInit] = persisted(
    { ...Persist.prompt(Persist.global("prompt-history")), migrate: upgradeHistoryState },
    createStore<PromptHistoryState>({ entries: [] }),
  )
  const [shell, setShell, shellInit] = persisted(
    { ...Persist.prompt(Persist.global("prompt-history-shell")), migrate: upgradeHistoryState },
    createStore<PromptHistoryState>({ entries: [] }),
  )
  const history = createComposerHistoryStore(normal, setNormal, shell, setShell)
  return {
    ...history,
    add(prompt: Prompt, mode: "normal" | "shell", comments: PromptHistoryComment[]) {
      const ready = mode === "shell" ? shellInit : normalInit
      if (!(ready instanceof Promise)) return history.add(prompt, mode, comments)
      const saved = clonePromptParts(prompt)
      const metadata = clonePromptHistoryComments(comments)
      void ready.then(() => history.add(saved, mode, metadata))
    },
  }
}
