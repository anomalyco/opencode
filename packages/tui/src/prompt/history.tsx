import path from "path"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { AgentPart, FilePart, TextPart } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "../context/helper"
import { useTuiPaths } from "../context/runtime"
import { appendText, readText, writeText } from "../util/persistence"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  sessionID?: string
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

export const MAX_HISTORY_ENTRIES = 50

export function parsePromptHistory(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PromptInfo
      } catch {
        return undefined
      }
    })
    .filter((line): line is PromptInfo => line !== undefined)
    .slice(-MAX_HISTORY_ENTRIES)
}

export function isDuplicateEntry(previous: PromptInfo | undefined, next: PromptInfo): boolean {
  if (!previous) return false
  return JSON.stringify(previous) === JSON.stringify(next)
}

// Resolves one history-navigation step. `index` is an offset from the end of
// the list (0 = the live input, -1 = the most recent entry). When `sessionID`
// is given, only entries appended in that session are recalled; the offset is
// also reset whenever it points at an entry from another session, so switching
// sessions restarts navigation from the live input.
export function moveHistoryEntry(
  history: PromptInfo[],
  index: number,
  direction: 1 | -1,
  input: string,
  sessionID?: string,
): { index: number; entry: PromptInfo } | undefined {
  const scoped = sessionID ? history.filter((entry) => entry.sessionID === sessionID) : history
  if (!scoped.length) return undefined
  if (index !== 0) {
    const pointed = scoped.at(index)
    const foreign = sessionID !== undefined && history.at(index)?.sessionID !== sessionID
    if (!pointed || foreign) index = 0
  }
  const current = scoped.at(index)
  if (!current) return undefined
  if (current.input !== input && input.length) return undefined
  const next = index + direction
  if (next > 0 || Math.abs(next) > scoped.length) return { index, entry: scoped.at(index) as PromptInfo }
  return { index: next, entry: next === 0 ? { input: "", parts: [] } : (scoped.at(next) as PromptInfo) }
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    onMount(async () => {
      const lines = parsePromptHistory(await readText(historyPath).catch(() => ""))
      setStore("history", lines)

      // Rewrite valid retained entries to self-heal corruption and enforce the limit.
      if (lines.length > 0)
        writeText(historyPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
    })

    return {
      move(direction: 1 | -1, input: string, sessionID?: string) {
        const result = moveHistoryEntry(store.history, store.index, direction, input, sessionID)
        if (!result) return undefined
        setStore("index", result.index)
        return result.entry
      },
      append(item: PromptInfo) {
        const entry = structuredClone(unwrap(item))
        if (isDuplicateEntry(store.history.at(-1), entry)) {
          setStore("index", 0)
          return
        }
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
            draft.index = 0
          }),
        )

        if (trimmed) {
          writeText(historyPath, store.history.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
          return
        }
        appendText(historyPath, JSON.stringify(entry) + "\n").catch(() => {})
      },
    }
  },
})
