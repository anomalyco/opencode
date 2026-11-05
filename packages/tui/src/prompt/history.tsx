import path from "path"
import { mkdirSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { readdir, rm, stat } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { measureEditText, type WidthMethod } from "@opentui/core"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { PromptInput } from "@opencode/schema"
import type { Types } from "effect"
import { createSimpleContext } from "../context/helper"
import { useTuiPaths } from "../context/runtime"
import { appendText, readText, writeText } from "../util/persistence"
import { keptVideoExtension } from "../component/prompt/local-attachment"

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

/** Where history and the stash keep the videos they were given as bytes. */
export function promptMediaDirectory(state: string) {
  return path.join(state, "prompt-media")
}

// History and the stash never keep a video's bytes. A video keeps its local file as a `file://` uri, and one without a
// file gets one under `state` now, so an entry written right after a restore has it too. Sending reads it again.
export function persistablePrompt(prompt: PromptInfo, state: string): PromptInfo {
  return {
    ...prompt,
    files: prompt.files?.map((file) => {
      const video = /^data:(video\/[^;,]+);base64,/.exec(file.uri)
      const local =
        video && (file.path ?? writeVideo(promptMediaDirectory(state), file.uri.slice(video[0].length), video[1]!))
      return local ? { ...file, uri: pathToFileURL(local).href, path: local } : file
    }),
  }
}

// Named for its content, written once. A video that cannot be written keeps its bytes rather than being dropped.
function writeVideo(directory: string, base64: string, mime: string) {
  const bytes = Buffer.from(base64, "base64")
  const file = path.join(directory, Bun.SHA256.hash(bytes, "hex") + keptVideoExtension(mime))
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
      touch(file)
      return file
    }
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporary, bytes)
    renameSync(temporary, file)
    return file
  } catch {
    void rm(temporary, { force: true }).catch(() => {})
    return undefined
  }
}

/**
 * Restarts the grace window of each kept video `prompt` names, for a prompt put back in the composer: the stash entry
 * it came from may have been the last to name them.
 */
export function keepPromptMedia(prompt: PromptInfo, state: string) {
  prompt.files?.forEach((file) => {
    if (file.path && path.dirname(file.path) === promptMediaDirectory(state)) touch(file.path)
  })
}

// Long enough for a draft in another window to reach history or the stash. Reusing a kept video restarts it.
const PROMPT_MEDIA_GRACE_MS = 24 * 60 * 60 * 1000

function touch(file: string) {
  const now = new Date()
  try {
    utimesSync(file, now, now)
  } catch {}
}

/**
 * Deletes the kept videos that no history or stash entry names. A file is named for its content, so its name in either
 * file's text is a reference. A file written within the grace window may belong to another window's draft and stays,
 * and nothing is deleted when either file cannot be read.
 */
export async function prunePromptMedia(state: string) {
  const directory = promptMediaDirectory(state)
  const names = await readdir(directory).catch(() => [])
  if (names.length === 0) return
  const [history, stash] = await Promise.all(
    ["prompt-history.jsonl", "prompt-stash.jsonl"].map((name) =>
      readText(path.join(state, name)).catch((error) => (error?.code === "ENOENT" ? "" : undefined)),
    ),
  )
  if (history === undefined || stash === undefined) return
  await Promise.all(
    names
      .filter((name) => !history.includes(name) && !stash.includes(name))
      .map(async (name) => {
        const file = path.join(directory, name)
        const info = await stat(file).catch(() => undefined)
        if (!info?.isFile() || Date.now() - info.mtimeMs < PROMPT_MEDIA_GRACE_MS) return
        await rm(file, { force: true }).catch(() => {})
      }),
  )
}

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
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    onMount(async () => {
      const lines = parsePromptHistory(await readText(historyPath).catch(() => ""))
      setStore("history", lines)

      // Rewrite valid retained entries to self-heal corruption and enforce the limit.
      if (lines.length > 0)
        await writeText(historyPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
      await prunePromptMedia(paths.state)
    })

    const [store, setStore] = createStore({ index: 0, history: [] as PromptInfo[] })

    return {
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        const current = store.history.at(store.index)
        if (!current) return undefined
        if (current.text !== input && input.length) return
        const next = store.index + direction
        if (Math.abs(next) > store.history.length || next > 0) return
        setStore("index", next)
        if (next === 0) return emptyPrompt()
        return store.history.at(next)
      },
      append(item: PromptInfo) {
        const entry = structuredClone(persistablePrompt(unwrap(item), paths.state))
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
          writeText(historyPath, store.history.map((line) => JSON.stringify(line)).join("\n") + "\n")
            .then(() => prunePromptMedia(paths.state))
            .catch(() => {})
          return
        }
        appendText(historyPath, JSON.stringify(entry) + "\n").catch(() => {})
      },
    }
  },
})
