import path from "path"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { PromptInput } from "@opencode-ai/schema"
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

export type PromptInfo = Types.DeepMutable<Pick<PromptInput.Prompt, "text" | "files" | "agents" | "skills">> & {
  pasted: PastedText[]
  mode?: "normal" | "shell"
}

export type PromptPartRef = {
  type: "file" | "agent" | "skill" | "pasted"
  index: number
}

type PromptHistoryEntry = {
  sessionID: string | undefined
  prompt: PromptInfo
}

export const emptyPrompt = (): PromptInfo => ({ text: "", files: [], agents: [], skills: [], pasted: [] })

export const MAX_HISTORY_ENTRIES = 50

export function parsePromptHistory(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const value: unknown = JSON.parse(line)
        const input = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
        const prompt = parsePromptInfo(input?.prompt ?? value)
        if (!prompt) return
        return {
          sessionID: typeof input?.sessionID === "string" ? input.sessionID : undefined,
          prompt,
        }
      } catch {
        return undefined
      }
    })
    .filter((line): line is PromptHistoryEntry => line !== undefined)
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
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    onMount(async () => {
      const lines = parsePromptHistory(await readText(historyPath).catch(() => ""))
      setStore("history", lines)

      // Rewrite valid retained entries to self-heal corruption and enforce the limit.
      if (lines.length > 0)
        writeText(historyPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
    })

    const [store, setStore] = createStore({ history: [] as PromptHistoryEntry[] })
    const indices = new Map<string | undefined, number>()

    return {
      move(sessionID: string | undefined, direction: 1 | -1, input: string) {
        const items = store.history.filter((entry) => entry.sessionID === sessionID)
        if (!items.length) return undefined
        const index = indices.get(sessionID) ?? 0
        const current = items.at(index)?.prompt
        if (!current) return undefined
        if (current.text !== input && input.length) return
        const next = index + direction
        if (Math.abs(next) > items.length || next > 0) return
        indices.set(sessionID, next)
        if (next === 0) return emptyPrompt()
        return items.at(next)?.prompt
      },
      append(sessionID: string | undefined, item: PromptInfo) {
        const entry = { sessionID, prompt: structuredClone(unwrap(item)) }
        const previous = store.history.findLast((item) => item.sessionID === sessionID)
        if (isDuplicateEntry(previous?.prompt, entry.prompt)) {
          indices.set(sessionID, 0)
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
          }),
        )
        indices.set(sessionID, 0)

        if (trimmed) {
          writeText(historyPath, store.history.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
          return
        }
        appendText(historyPath, JSON.stringify(entry) + "\n").catch(() => {})
      },
    }
  },
})
