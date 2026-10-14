import path from "path"
import { measureEditText, type WidthMethod } from "@opentui/core"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { PromptInput } from "@opencode/schema"
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

// `path` is the local file a pasted attachment was read from. It stays in the TUI.
export type PromptFile = Types.DeepMutable<PromptInput.FileAttachment> & { path?: string }

export type PromptInfo = Types.DeepMutable<Pick<PromptInput.Prompt, "text" | "agents" | "skills">> & {
  files?: PromptFile[]
  pasted: PastedText[]
  mode?: "normal" | "shell"
}

export type PromptPartRef = {
  type: "file" | "agent" | "skill" | "pasted"
  index: number
}

export type PromptHistoryScope = "global" | "session"

type PromptHistoryEntry = {
  sessionID: string | undefined
  prompt: PromptInfo
}

export const emptyPrompt = (): PromptInfo => ({ text: "", files: [], agents: [], skills: [], pasted: [] })

// Part ranges are textarea offsets, so shift by the measured offset rather than string length.
export function appendPrompt(prompt: PromptInfo, following: PromptInfo, widthMethod: WidthMethod): PromptInfo {
  const text = prompt.text ? `${prompt.text}\n\n` : ""
  const offset = measureEditText(text, { widthMethod })
  const shift = <T extends { start: number; end: number }>(range: T, by: number) => ({
    ...range,
    start: range.start + by,
    end: range.end + by,
  })
  const mentions = <T extends { mention?: { start: number; end: number } }>(
    items: T[] | undefined,
    next: T[] | undefined,
  ) => [
    ...(items ?? []).map((item) => ({ ...item, mention: item.mention && shift(item.mention, 0) })),
    ...(next ?? []).map((item) => ({ ...item, mention: item.mention && shift(item.mention, offset) })),
  ]
  return {
    text: text + following.text,
    files: mentions(prompt.files, following.files),
    agents: mentions(prompt.agents, following.agents),
    skills: mentions(prompt.skills, following.skills),
    pasted: [
      ...prompt.pasted.map((part) => ({ ...part, source: shift(part.source, 0) })),
      ...following.pasted.map((part) => ({ ...part, source: shift(part.source, offset) })),
    ],
  }
}

export const MAX_HISTORY_ENTRIES = 50

export function parsePromptHistory(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const value: unknown = JSON.parse(line)
        const input = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
        if (!input) return
        const sessionID = typeof input.sessionID === "string" ? input.sessionID : undefined
        // Persisted entries stay flat (`{ ...prompt, sessionID? }`) so older readers keep
        // working; only the in-memory entry is split.
        delete input.sessionID
        const prompt = parsePromptInfo(input)
        if (!prompt) return
        return { sessionID, prompt }
      } catch {
        return undefined
      }
    })
    .filter((line): line is PromptHistoryEntry => line !== undefined)
    .slice(-MAX_HISTORY_ENTRIES)
}

export function serializeHistoryEntry(entry: PromptHistoryEntry): string {
  return JSON.stringify({ ...entry.prompt, sessionID: entry.sessionID })
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
        writeText(historyPath, lines.map(serializeHistoryEntry).join("\n") + "\n").catch(() => {})
    })

    const [store, setStore] = createStore({ index: 0, history: [] as PromptHistoryEntry[] })
    const sessionIndices = new Map<string | undefined, number>()

    return {
      move(sessionID: string | undefined, direction: 1 | -1, input: string, scope: PromptHistoryScope) {
        if (scope === "session") {
          const items = store.history.filter((entry) => entry.sessionID === sessionID)
          if (!items.length) return undefined
          const index = sessionIndices.get(sessionID) ?? 0
          const current = items.at(index)?.prompt
          if (!current) return undefined
          if (current.text !== input && input.length) return
          const next = index + direction
          if (Math.abs(next) > items.length || next > 0) return
          sessionIndices.set(sessionID, next)
          if (next === 0) return emptyPrompt()
          return items.at(next)?.prompt
        }
        if (!store.history.length) return undefined
        const current = store.history.at(store.index)?.prompt
        if (!current) return undefined
        if (current.text !== input && input.length) return
        const next = store.index + direction
        if (Math.abs(next) > store.history.length || next > 0) return
        setStore("index", next)
        if (next === 0) return emptyPrompt()
        return store.history.at(next)?.prompt
      },
      append(sessionID: string | undefined, item: PromptInfo, scope: PromptHistoryScope) {
        const entry = { sessionID, prompt: structuredClone(unwrap(item)) }
        const previous =
          scope === "session"
            ? store.history.findLast((existing) => existing.sessionID === sessionID)?.prompt
            : store.history.at(-1)?.prompt
        // Every submit returns every composer to its draft position, including the home
        // composer that submitted under a session it just created.
        sessionIndices.clear()
        setStore("index", 0)
        if (isDuplicateEntry(previous, entry.prompt)) return
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              // In session scope the active session's prompts are trimmed last: other
              // sessions must not push them out of a scoped recall.
              if (scope === "session") {
                while (draft.history.length > MAX_HISTORY_ENTRIES) {
                  const oldestOther = draft.history.findIndex((existing) => existing.sessionID !== sessionID)
                  draft.history.splice(oldestOther === -1 ? 0 : oldestOther, 1)
                }
              } else {
                draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              }
              trimmed = true
            }
          }),
        )

        if (trimmed) {
          writeText(historyPath, store.history.map(serializeHistoryEntry).join("\n") + "\n").catch(() => {})
          return
        }
        appendText(historyPath, serializeHistoryEntry(entry) + "\n").catch(() => {})
      },
    }
  },
})
