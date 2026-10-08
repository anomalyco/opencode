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

export function createPromptHistory(persistence: {
  read: () => Promise<string>
  write: (content: string) => Promise<void>
  append: (content: string) => Promise<void>
}) {
  const [store, setStore] = createStore({
    index: 0,
    history: [] as PromptInfo[],
  })
  const pending: PromptInfo[] = []
  let loaded = false
  let persist = Promise.resolve()

  function schedule(operation: () => Promise<void>) {
    persist = persist.then(operation).catch(() => {})
    return persist
  }

  async function load() {
    const lines = parsePromptHistory(await persistence.read().catch(() => ""))
    const history = pending
      .reduce<PromptInfo[]>((result, entry) => {
        if (isDuplicateEntry(result.at(-1), entry)) return result
        return [...result, entry]
      }, lines)
      .slice(-MAX_HISTORY_ENTRIES)
    pending.length = 0
    setStore("history", history)
    loaded = true

    // Rewrite valid retained entries to self-heal corruption and enforce the limit.
    if (lines.length > 0)
      await schedule(() => persistence.write(history.map((line) => JSON.stringify(line)).join("\n") + "\n"))
  }

  function move(direction: 1 | -1, input: string) {
    if (!store.history.length) return undefined
    const current = store.history.at(store.index)
    if (!current) return undefined
    if (current.input !== input && input.length) return
    setStore(
      produce((draft) => {
        const next = store.index + direction
        if (Math.abs(next) > store.history.length) return
        if (next > 0) return
        draft.index = next
      }),
    )
    if (store.index === 0) return { input: "", parts: [] }
    return store.history.at(store.index)
  }

  function append(item: PromptInfo) {
    const entry = structuredClone(unwrap(item))
    if (isDuplicateEntry(store.history.at(-1), entry)) {
      setStore("index", 0)
      return
    }
    if (!loaded) pending.push(entry)
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
      const content = store.history.map((line) => JSON.stringify(line)).join("\n") + "\n"
      void schedule(() => persistence.write(content))
      return
    }
    void schedule(() => persistence.append(JSON.stringify(entry) + "\n"))
  }

  return { load, move, append }
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    const history = createPromptHistory({
      read: () => readText(historyPath),
      write: (content) => writeText(historyPath, content),
      append: (content) => appendText(historyPath, content),
    })
    onMount(history.load)
    return { move: history.move, append: history.append }
  },
})
