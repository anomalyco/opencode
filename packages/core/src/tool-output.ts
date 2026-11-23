export * as ToolOutput from "./tool-output.js"

import path from "path"
import type { Tool } from "./tool.js"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { TextBoundary } from "@opencode/util/text-boundary"
import { Identifier } from "@opencode/schema/identifier"
import { FileRetention } from "./file-retention.js"
import { State } from "./state.js"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024 // 50 KiB
export const RETENTION = Duration.days(7)
export const DIRECTORY = "tool-output"

export const fileName = (timestamp?: number) => "tool_" + Identifier.create(false, timestamp)

type Result = Tool.NormalizedResult

/**
 * How a result over the limits is cut: `head` keeps its start, `head-tail` keeps its start and end around one marker.
 * `head-tail` is the default with `full_codemode` (configured by the tool output config plugin), so a result's last
 * lines, like an exit code or error, stay visible.
 */
export type Strategy = "head" | "head-tail"

export type TruncateOptions = {
  readonly strategy?: Strategy
  /**
   * The full output when the result's text is already a shortened form of it. It is saved in place of the text, and
   * even when the text fits, so the result's one marker and `outputPath` point to everything.
   */
  readonly full?: string
}

export type Limits = {
  maxLines: number
  maxBytes: number
}

export type Editor = {
  configure: (limits: Partial<Limits & { strategy: Strategy }>) => void
}

export interface Interface extends State.Transformable<Editor> {
  /** The configured `tool_output` limits a result is cut to. */
  readonly limits: Effect.Effect<Limits>
  readonly truncate: (result: Result, options?: TruncateOptions) => Effect.Effect<Result>
  /** Writes bytes the model cannot receive inline to a retained file and returns its path. */
  readonly save: (bytes: Uint8Array, extension: string) => Effect.Effect<string>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolOutput") {}

const cleanup = Effect.fn("ToolOutput.cleanup")(function* (fs: FSUtil.Interface, directory: string) {
  const entries = yield* fs.readDirectory(directory).pipe(
    Effect.map((entries) => entries.filter((entry) => /^tool_[0-9a-f]{12}/.test(entry))),
    Effect.orElseSucceed(() => []),
  )
  yield* FileRetention.cleanup(
    fs,
    entries.map((entry) => path.join(directory, entry)),
    RETENTION,
  )
})

// The system error message ("ENOSPC: no space left on device, write") without the stack or wrapper text.
const describe = (error: FSUtil.Error) => {
  const cause = error._tag === "PlatformError" ? error.reason.cause : error.cause
  return cause instanceof Error ? cause.message.split("\n")[0] : error.message
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const directory = path.join(global.data, DIRECTORY)
    const state = State.create<Limits & { strategy: Strategy }, Editor>({
      name: "tool-output",
      initial: () => ({ maxLines: MAX_LINES, maxBytes: MAX_BYTES, strategy: "head" }),
      editor: (editor) => ({
        configure: (limits) => {
          if (limits.maxLines !== undefined) editor.maxLines = limits.maxLines
          if (limits.maxBytes !== undefined) editor.maxBytes = limits.maxBytes
          if (limits.strategy !== undefined) editor.strategy = limits.strategy
        },
      }),
    })

    const write = Effect.fnUntraced(function* (text: string) {
      const file = path.join(directory, fileName())
      const failure = yield* fs.ensureDir(directory).pipe(
        Effect.andThen(fs.writeFileString(file, text)),
        Effect.as(undefined),
        Effect.catch((error) =>
          Effect.logWarning("failed to save full tool output", { file, cause: error }).pipe(Effect.as(describe(error))),
        ),
      )
      return {
        file,
        failure,
        saved: failure === undefined ? `full output saved to ${file}` : `full output could not be saved: ${failure}`,
      }
    })

    const truncate = Effect.fnUntraced(function* (result: Result, options?: TruncateOptions) {
      if (result.metadata?.truncated !== undefined) return result
      const content = result.content
      // A line break joins text parts unless the text before already ends in one.
      const text = content.reduce(
        (joined, item) =>
          item.type !== "text"
            ? joined
            : joined === "" || joined.endsWith("\n")
              ? joined + item.text
              : `${joined}\n${item.text}`,
        "",
      )
      const limits = state.get()
      const totalLines = countLines(text)
      const fits = totalLines <= limits.maxLines && Buffer.byteLength(text, "utf-8") <= limits.maxBytes
      if (fits && options?.full === undefined) return { ...result, metadata: { ...result.metadata, truncated: false } }
      const saved = yield* write(options?.full ?? text)
      const metadata = {
        ...result.metadata,
        truncated: true,
        ...(saved.failure === undefined && { outputPath: saved.file }),
      }
      // A shortened text that fits takes the note on its own line, unless the note would push it over the limits.
      const note = `[${saved.saved}]`
      if (
        fits &&
        totalLines + 1 <= limits.maxLines &&
        Buffer.byteLength(`${text}\n${note}`, "utf-8") <= limits.maxBytes
      )
        return { ...result, content: [...content, { type: "text" as const, text: note }], metadata }

      if ((options?.strategy ?? limits.strategy) === "head-tail") {
        const cut = headTail(text, limits)
        const marker = `[… ${cut.lines} ${cut.lines === 1 ? "line" : "lines"} (${formatSize(cut.bytes)}) cut from the middle; ${saved.saved}]`
        const shown = `${cut.head}${cut.head === "" || cut.head.endsWith("\n") ? "" : "\n"}${marker}${cut.tail === "" ? "" : `\n${cut.tail}`}`
        // The text parts become one, where the first was; files keep their places.
        const first = content.findIndex((item) => item.type === "text")
        return {
          ...result,
          content: content.flatMap((item, index): Tool.Content[] =>
            item.type !== "text" ? [item] : index === first ? [{ ...item, text: shown }] : [],
          ),
          metadata,
        }
      }

      // Cut once, at the line or byte limit, whichever comes first, so a line too long for the space left shows its
      // start. The preview never ends on a line break.
      const end = Math.min(afterLines(text, limits.maxLines), byteBoundary(text, limits.maxBytes))
      const shown = text.slice(0, text.endsWith("\r\n", end) ? end - 2 : text.endsWith("\n", end) ? end - 1 : end)
      // Counted before the final line break is stripped, so a blank last line still counts.
      const shownLines = countLines(text.slice(0, end))
      const lastLineCut =
        shownLines > 0 &&
        shown.length < text.length &&
        !text.startsWith("\n", shown.length) &&
        !text.startsWith("\r\n", shown.length)
      const range = shownLines === 0 ? "0 lines" : `lines 1-${shownLines}`
      const marker = `[showing ${range} of ${totalLines}${lastLineCut ? " (last line cut)" : ""}; ${saved.saved}]`
      const bounded: Tool.Content[] = []
      let remaining = shown.length
      let separator = false
      let marked = false
      for (const item of content) {
        if (item.type === "file") {
          bounded.push(item)
          continue
        }
        if (separator && remaining > 0) remaining--
        separator = item.text !== "" && !item.text.endsWith("\n")
        if (!marked && remaining >= item.text.length) {
          bounded.push(item)
          remaining -= item.text.length
          continue
        }
        if (remaining > 0) bounded.push({ ...item, text: item.text.slice(0, remaining) })
        if (!marked) bounded.push({ type: "text", text: marker })
        remaining = 0
        marked = true
      }
      if (!marked) bounded.push({ type: "text", text: marker })
      return {
        ...result,
        content: bounded,
        metadata,
      }
    })

    const save = Effect.fnUntraced(function* (bytes: Uint8Array, extension: string) {
      const file = path.join(directory, fileName() + extension)
      yield* fs.writeWithDirs(file, bytes).pipe(Effect.orDie)
      return file
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      limits: Effect.sync(() => ({ maxLines: state.get().maxLines, maxBytes: state.get().maxBytes })),
      truncate,
      save,
      cleanup: () => cleanup(fs, directory),
    })
  }),
)

const cleanupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    yield* cleanup(fs, path.join(global.data, DIRECTORY)).pipe(
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.forkScoped,
    )
  }),
)

const cleanupNode = makeGlobalNode({
  name: "tool-output-cleanup",
  layer: cleanupLayer,
  deps: [FSUtil.node, Global.node],
})

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, cleanupNode],
})

/** How many lines `text` has, not counting an empty one after a final line break. Counts without splitting. */
export function countLines(text: string) {
  if (text === "") return 0
  let count = 1
  for (let index = text.indexOf("\n"); index !== -1 && index < text.length - 1; index = text.indexOf("\n", index + 1))
    count++
  return count
}

// Room left for the middle marker, whose path and counts vary in length.
const MARKER_BYTES = 512
const HEAD_SHARE = 0.6

/**
 * About 60% of the room from the start of `text` and 40% from its end, in whole lines. A line too long for its share
 * is cut on a character boundary instead: the head keeps its start, the tail its end.
 */
function headTail(text: string, limits: Limits) {
  const lines = Math.max(0, limits.maxLines - 1)
  const bytes = Math.max(0, limits.maxBytes - MARKER_BYTES)
  const headLines = Math.floor(lines * HEAD_SHARE)
  const headBytes = Math.floor(bytes * HEAD_SHARE)
  const cut = Math.min(afterLines(text, headLines), byteBoundary(text, headBytes))
  const headEnd =
    cut === 0 || cut === text.length || text[cut - 1] === "\n" ? cut : text.lastIndexOf("\n", cut - 1) + 1 || cut
  const byteStart = text.length - TextBoundary.utf8Tail(encoder.encode(text), bytes - headBytes).length
  const start = Math.max(headEnd, byteStart, beforeLines(text, lines - headLines))
  const next = text.indexOf("\n", start) + 1
  const tailStart = start === headEnd || text[start - 1] === "\n" || next === 0 || next === text.length ? start : next
  const middle = text.slice(headEnd, tailStart)
  return {
    head: text.slice(0, headEnd),
    tail: text.slice(tailStart),
    lines: countLines(middle),
    bytes: Buffer.byteLength(middle, "utf-8"),
  }
}

/** Where the last `count` lines of `text` start, not counting an empty one after a final line break. */
function beforeLines(text: string, count: number) {
  if (count <= 0) return text.length
  let index = text.endsWith("\n") ? text.length - 1 : text.length
  for (let line = 0; line < count; line++) {
    index = text.lastIndexOf("\n", index - 1)
    if (index === -1) return 0
  }
  return index + 1
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`
  const kb = bytes / 1024
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MiB` : `${kb.toFixed(1)} KiB`
}

/** Where the line after the first `count` lines starts, or the end of `text`. */
function afterLines(text: string, count: number) {
  let index = 0
  for (let line = 0; line < count; line++) {
    const next = text.indexOf("\n", index)
    if (next === -1) return text.length
    index = next + 1
  }
  return index
}

const encoder = new TextEncoder()
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** The longest start of `text` that fits in `budget` UTF-8 bytes without splitting a character, emoji included. */
function byteBoundary(text: string, budget: number) {
  // encodeInto only encodes what fits in the buffer, and stops at a whole code point.
  const index = encoder.encodeInto(text, new Uint8Array(Math.max(0, budget))).read
  if (index === text.length || index === 0) return index
  const before = text.charCodeAt(index - 1)
  const after = text.charCodeAt(index)
  // Two ASCII characters always have a boundary between them, except the two halves of \r\n.
  if (before < 0x80 && after < 0x80) return before === 13 && after === 10 ? index - 1 : index
  // Otherwise back off to the start of the grapheme the cut is in. A line break always ends one, so segmenting from the
  // start of the line keeps flag pairs and long emoji sequences exact; one code point past the cut gives the context.
  const start = text.lastIndexOf("\n", index - 1) + 1
  return start + (graphemes.segment(text.slice(start, index + 2)).containing(index - start)?.index ?? index - start)
}
