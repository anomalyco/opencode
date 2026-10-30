import path from "path"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { AgentPart, FilePart, TextPart } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "../context/helper"
import { useTuiPaths } from "../context/runtime"
import { useTuiConfig } from "../config"
import { appendText, readText, writeText } from "../util/persistence"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

// A history entry remembers the session it was written in. Entries written before sessions were recorded, and
// drafts cleared on the home screen, have none.
export type PromptHistoryEntry = PromptInfo & { sessionID?: string }

export type PromptHistoryScope = "global" | "session"
export const PromptHistoryScopeDefault: PromptHistoryScope = "global"

export const MAX_HISTORY_ENTRIES = 50
// With the session scope, how many of the most recently used sessions keep their entries.
export const MAX_HISTORY_SESSIONS = 50

export function parsePromptHistory(text: string, scope: PromptHistoryScope = PromptHistoryScopeDefault) {
  return retainPromptHistory(
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as PromptHistoryEntry
        } catch {
          return undefined
        }
      })
      .filter((line): line is PromptHistoryEntry => line !== undefined),
    scope,
  )
}

/**
 * The entries the history file keeps. The global scope keeps the newest MAX_HISTORY_ENTRIES of all of them. The
 * session scope keeps the newest MAX_HISTORY_ENTRIES of each of the MAX_HISTORY_SESSIONS most recently used sessions,
 * entries without a session counting as one more, so a busy session cannot push a quieter one's history out.
 */
export function retainPromptHistory(entries: PromptHistoryEntry[], scope: PromptHistoryScope) {
  if (scope === "global") return entries.slice(-MAX_HISTORY_ENTRIES)
  const counts = new Map<string, number>()
  return entries
    .toReversed()
    .filter((entry) => {
      const key = entry.sessionID ?? ""
      const count = counts.get(key) ?? (counts.size < MAX_HISTORY_SESSIONS ? 0 : undefined)
      if (count === undefined || count >= MAX_HISTORY_ENTRIES) return false
      counts.set(key, count + 1)
      return true
    })
    .toReversed()
}

/**
 * The entries up and down walk through. The session scope shows a session only the prompts written in it; the home
 * screen, which has no session yet, shows every session's, as the global scope does everywhere.
 */
export function promptHistoryView(entries: PromptHistoryEntry[], scope: PromptHistoryScope, sessionID?: string) {
  if (scope === "session" && sessionID)
    return entries.filter((entry) => entry.sessionID === sessionID).slice(-MAX_HISTORY_ENTRIES)
  return entries.slice(-MAX_HISTORY_ENTRIES)
}

export function isDuplicateEntry(previous: PromptHistoryEntry | undefined, next: PromptHistoryEntry): boolean {
  if (!previous) return false
  return JSON.stringify({ ...previous, sessionID: undefined }) === JSON.stringify({ ...next, sessionID: undefined })
}

const serialize = (entries: PromptHistoryEntry[]) => entries.map((line) => JSON.stringify(line)).join("\n") + "\n"

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const tuiConfig = useTuiConfig()
    const scope = () => tuiConfig.prompt?.history_scope ?? PromptHistoryScopeDefault
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    onMount(async () => {
      const lines = parsePromptHistory(await readText(historyPath).catch(() => ""), scope())
      setStore("history", lines)

      // Rewrite valid retained entries to self-heal corruption and enforce the limit.
      if (lines.length > 0) writeText(historyPath, serialize(lines)).catch(() => {})
    })

    const [store, setStore] = createStore({
      index: 0,
      // The session the index walks the history of; another one starts over from the newest entry.
      sessionID: undefined as string | undefined,
      history: [] as PromptHistoryEntry[],
    })

    return {
      move(direction: 1 | -1, input: string, sessionID?: string) {
        if (store.sessionID !== sessionID) setStore({ index: 0, sessionID })
        const history = promptHistoryView(store.history, scope(), sessionID)
        if (!history.length) return undefined
        const current = history.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setStore(
          produce((draft) => {
            const next = store.index + direction
            if (Math.abs(next) > history.length) return
            if (next > 0) return
            draft.index = next
          }),
        )
        if (store.index === 0) return { input: "", parts: [] }
        const { sessionID: _, ...item } = history.at(store.index)!
        return item as PromptInfo
      },
      append(item: PromptInfo, sessionID?: string) {
        // sessionID is set even when undefined, so an entry recalled from another session does not keep that one's.
        const entry: PromptHistoryEntry = { ...structuredClone(unwrap(item)), sessionID }
        if (isDuplicateEntry(promptHistoryView(store.history, scope(), sessionID).at(-1), entry)) {
          setStore({ index: 0, sessionID })
          return
        }
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            const retained = retainPromptHistory(draft.history, scope())
            if (retained.length !== draft.history.length) {
              draft.history = retained
              trimmed = true
            }
            draft.index = 0
            draft.sessionID = sessionID
          }),
        )

        // Other TUIs append to the same file, so a trim rereads it rather than writing this one's view over theirs.
        appendText(historyPath, JSON.stringify(entry) + "\n")
          .then(async () => {
            if (!trimmed) return
            await writeText(historyPath, serialize(parsePromptHistory(await readText(historyPath), scope())))
          })
          .catch(() => {})
      },
    }
  },
})
