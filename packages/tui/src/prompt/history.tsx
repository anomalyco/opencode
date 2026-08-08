import path from "path"
import { unwrap } from "solid-js/store"
import type { SessionPromptInput } from "@opencode-ai/client"
import type { Types } from "effect"
import { createSimpleContext } from "../context/helper"
import { useTuiPaths } from "../context/runtime"
import { appendText, readText, writeText } from "../util/persistence"

export type PastedText = {
  text: string
  source: {
    start: number
    end: number
    text: string
  }
}

export type PromptInfo = Types.DeepMutable<Pick<SessionPromptInput, "text" | "files" | "agents">> & {
  pasted: PastedText[]
  mode?: "normal" | "shell"
}

export type PromptPartRef = {
  type: "file" | "agent" | "pasted"
  index: number
}

export const emptyPrompt = (): PromptInfo => ({ text: "", files: [], agents: [], pasted: [] })

export const MAX_HISTORY_ENTRIES = 50

export function parsePromptHistory(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return parsePromptInfo(JSON.parse(line))
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

export function parsePromptInfo(value: unknown): PromptInfo | undefined {
  if (!value || typeof value !== "object") return
  const input = value as Record<string, unknown>
  if (typeof input.text !== "string" || !Array.isArray(input.pasted)) return
  return input as PromptInfo
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const stores = new Map<string, { index: number; history: PromptInfo[] }>()
    const loaded = new Set<string>()
    const key = (sessionID?: string) => sessionID ?? "new"
    const historyPath = (sessionID?: string) =>
      path.join(paths.state, "prompt-history", encodeURIComponent(key(sessionID)) + ".jsonl")
    const store = (sessionID?: string) => {
      const id = key(sessionID)
      const current = stores.get(id)
      if (current) return current
      const next = { index: 0, history: [] as PromptInfo[] }
      stores.set(id, next)
      return next
    }

    return {
      async load(sessionID?: string) {
        const id = key(sessionID)
        if (loaded.has(id)) return
        loaded.add(id)
        const lines = parsePromptHistory(await readText(historyPath(sessionID)).catch(() => ""))
        const current = stores.get(id)
        const history = [...lines, ...(current?.history ?? [])]
          .filter((entry, index, entries) => !isDuplicateEntry(entries[index - 1], entry))
          .slice(-MAX_HISTORY_ENTRIES)
        stores.set(id, { index: current?.index ?? 0, history })
        if (lines.length > 0)
          writeText(historyPath(sessionID), history.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(
            () => {},
          )
      },
      move(sessionID: string | undefined, direction: 1 | -1, input: string) {
        const state = store(sessionID)
        if (!state.history.length) return undefined
        const current = state.history.at(state.index)
        if (!current) return undefined
        if (current.text !== input && input.length) return
        const next = state.index + direction
        if (Math.abs(next) > state.history.length || next > 0) return
        state.index = next
        if (next === 0) return emptyPrompt()
        return state.history.at(next)
      },
      append(sessionID: string | undefined, item: PromptInfo) {
        const state = store(sessionID)
        const entry = structuredClone(unwrap(item))
        if (isDuplicateEntry(state.history.at(-1), entry)) {
          state.index = 0
          return
        }
        state.history.push(entry)
        const trimmed = state.history.length > MAX_HISTORY_ENTRIES
        if (trimmed) state.history = state.history.slice(-MAX_HISTORY_ENTRIES)
        state.index = 0

        if (trimmed) {
          writeText(historyPath(sessionID), state.history.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(
            () => {},
          )
          return
        }
        appendText(historyPath(sessionID), JSON.stringify(entry) + "\n").catch(() => {})
      },
    }
  },
})
