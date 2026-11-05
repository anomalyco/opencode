import path from "path"
import { measureEditText, type WidthMethod } from "@opentui/core"
import { createSignal, onMount } from "solid-js"
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

export type PromptHistoryEntry = {
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

type CursorKey = string | null

// The home composer has no session ID, but it still needs its own cursor. A null key keeps
// it distinct from every real session instead of sharing the `undefined` map entry.
const cursorKey = (sessionID: string | undefined): CursorKey => sessionID ?? null

// Returns the next cursor position, or undefined when the move is not allowed: the composer
// must hold the current item (or be empty) to start navigating, and the cursor never passes
// the oldest entry or the newest one (0 is the empty draft).
function nextIndex(items: PromptInfo[], index: number, direction: 1 | -1, input: string) {
  const current = items.at(index)
  if (!current) return undefined
  if (current.text !== input && input.length) return undefined
  const next = index + direction
  if (Math.abs(next) > items.length || next > 0) return undefined
  return next
}

// Keep the newest MAX_HISTORY_ENTRIES for each session independently. Session scope must
// not let a busy session evict another session's recall; global scope still uses the same
// per-session bound when a session-only file is loaded.
export function trimHistoryEntries(entries: PromptHistoryEntry[]) {
  const counts = new Map<CursorKey, number>()
  const keep = new Array<boolean>(entries.length).fill(false)
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const key = cursorKey(entries[index]!.sessionID)
    const count = counts.get(key) ?? 0
    if (count < MAX_HISTORY_ENTRIES) {
      keep[index] = true
      counts.set(key, count + 1)
    }
  }
  return entries.filter((_, index) => keep[index])
}

export function parsePromptHistory(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const value: unknown = JSON.parse(line)
        if (!value || typeof value !== "object") return
        // Persisted entries are flat (`{ ...prompt, sessionID? }`) so older readers keep
        // working; only the in-memory entry is split.
        const { sessionID, ...prompt } = value as Record<string, unknown>
        const info = parsePromptInfo(prompt)
        if (!info) return
        return { sessionID: typeof sessionID === "string" ? sessionID : undefined, prompt: info }
      } catch {
        return undefined
      }
    })
    .filter((line): line is PromptHistoryEntry => line !== undefined)
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
  // Copy only the fields this application understands. In particular, do not spread an
  // arbitrary JSON object, because an own `__proto__` key in a hand-edited file must not
  // become part of the prompt object.
  const info: PromptInfo = { text: input.text, pasted: input.pasted as PastedText[] }
  if (Array.isArray(input.files)) info.files = input.files as PromptFile[]
  if (Array.isArray(input.agents)) info.agents = input.agents as NonNullable<PromptInfo["agents"]>
  if (Array.isArray(input.skills)) info.skills = input.skills as NonNullable<PromptInfo["skills"]>
  if (input.mode === "normal" || input.mode === "shell") info.mode = input.mode
  return info
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    const [error, setError] = createSignal<string>()

    const report = (action: "read" | "save", cause: unknown) => {
      if (action === "read" && (cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return
      setError(`Prompt history could not be ${action === "read" ? "read" : "saved"}`)
    }

    onMount(async () => {
      const lines = parsePromptHistory(
        await readText(historyPath).catch((cause) => {
          report("read", cause)
          return ""
        }),
      )
      const retained = trimHistoryEntries(lines)
      setStore("history", retained)

      // Rewrite valid retained entries to self-heal corruption and enforce the per-session
      // limit. A loaded file with only invalid lines is left alone.
      if (retained.length > 0 || retained.length !== lines.length)
        writeText(historyPath, retained.map(serializeHistoryEntry).join("\n") + "\n").catch((cause) =>
          report("save", cause),
        )
    })

    const [store, setStore] = createStore({ index: 0, history: [] as PromptHistoryEntry[] })
    const sessionIndices = new Map<CursorKey, number>()
    let lastScope: PromptHistoryScope | undefined
    const sessionKey = (sessionID: string | undefined) => cursorKey(sessionID)

    // Switching scope in a live reload invalidates the cursor that the other scope owns.
    // Reset the destination cursor rather than letting a stale index skip the newest item.
    const prepareScope = (scope: PromptHistoryScope) => {
      if (lastScope === scope) return
      lastScope = scope
      if (scope === "global") setStore("index", 0)
      else sessionIndices.clear()
    }

    return {
      error,
      clearError() {
        setError(undefined)
      },
      has(sessionID: string | undefined, scope: PromptHistoryScope) {
        if (scope === "global") return store.history.length > 0
        const key = sessionKey(sessionID)
        return store.history.some((entry) => cursorKey(entry.sessionID) === key)
      },
      move(sessionID: string | undefined, direction: 1 | -1, input: string, scope: PromptHistoryScope) {
        prepareScope(scope)
        if (scope === "session") {
          const key = sessionKey(sessionID)
          const items = store.history.filter((entry) => cursorKey(entry.sessionID) === key).map((entry) => entry.prompt)
          let index = sessionIndices.get(key) ?? 0
          if (items.length > 0 && !items.at(index)) index = 0
          const next = nextIndex(items, index, direction, input)
          if (next === undefined) return undefined
          sessionIndices.set(key, next)
          return next === 0 ? emptyPrompt() : items.at(next)
        }
        // The global view is the newest 50 entries across all sessions. Session-scope
        // retention can make the file longer than that, so slice the view rather than
        // truncating the persisted history.
        const items = store.history.slice(-MAX_HISTORY_ENTRIES).map((entry) => entry.prompt)
        const next = nextIndex(items, store.index, direction, input)
        if (next === undefined) return undefined
        setStore("index", next)
        return next === 0 ? emptyPrompt() : items.at(next)
      },
      append(sessionID: string | undefined, item: PromptInfo, scope: PromptHistoryScope) {
        prepareScope(scope)
        const key = sessionKey(sessionID)
        const entry = { sessionID, prompt: structuredClone(unwrap(item)) }
        // Session scope dedupes against the session's own last prompt, because the recall
        // pool is the session's history and not the file's; global scope keeps the old
        // whole-file behavior.
        const previous =
          scope === "session"
            ? store.history.findLast((existing) => cursorKey(existing.sessionID) === key)?.prompt
            : store.history.at(-1)?.prompt
        // A submit resets only the submitting composer's cursor. Other sessions keep their
        // independent positions, and the home composer keeps its own null-keyed position.
        if (scope === "session") sessionIndices.set(key, 0)
        else setStore("index", 0)
        if (isDuplicateEntry(previous, entry.prompt)) return
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (scope === "session") {
              let count = draft.history.filter((existing) => cursorKey(existing.sessionID) === key).length
              while (count > MAX_HISTORY_ENTRIES) {
                const oldest = draft.history.findIndex((existing) => cursorKey(existing.sessionID) === key)
                if (oldest < 0) break
                draft.history.splice(oldest, 1)
                count -= 1
                trimmed = true
              }
            } else if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
          }),
        )

        if (trimmed) {
          writeText(historyPath, store.history.map(serializeHistoryEntry).join("\n") + "\n").catch((cause) =>
            report("save", cause),
          )
          return
        }
        appendText(historyPath, serializeHistoryEntry(entry) + "\n").catch((cause) => report("save", cause))
      },
    }
  },
})
