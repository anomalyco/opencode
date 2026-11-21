export * as ToolOutput from "./tool-output.js"

import path from "path"
import type { Tool } from "./tool.js"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Identifier } from "@opencode/schema/identifier"
import { FileRetention } from "./file-retention.js"
import { State } from "./state.js"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024 // 50 KiB
export const RETENTION = Duration.days(7)
export const DIRECTORY = "tool-output"

export const fileName = (timestamp?: number) => "tool_" + Identifier.create(false, timestamp)

type Result = Tool.NormalizedResult

type Limits = {
  maxLines: number
  maxBytes: number
}

export type Editor = {
  configure: (limits: Partial<Limits>) => void
}

export interface Interface extends State.Transformable<Editor> {
  readonly truncate: (result: Result) => Effect.Effect<Result>
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
    const state = State.create<Limits, Editor>({
      name: "tool-output",
      initial: () => ({ maxLines: MAX_LINES, maxBytes: MAX_BYTES }),
      editor: (editor) => ({
        configure: (limits) => {
          if (limits.maxLines !== undefined) editor.maxLines = limits.maxLines
          if (limits.maxBytes !== undefined) editor.maxBytes = limits.maxBytes
        },
      }),
    })

    const truncate = Effect.fnUntraced(function* (result: Result) {
      if (result.metadata?.truncated !== undefined) return result
      const content = result.content
      // A line break joins text parts unless the text before already ends in one. Keep each part's character range so
      // the preview can cut inside a part and still put the marker next to the text it replaces.
      const ranges: { index: number; start: number; end: number }[] = []
      let text = ""
      content.forEach((item, index) => {
        if (item.type !== "text") return
        const separator = text === "" || text.endsWith("\n") ? "" : "\n"
        const start = text.length + separator.length
        text += separator + item.text
        ranges.push({ index, start, end: text.length })
      })
      const limits = state.get()
      const totalLines = countLines(text)
      const totalBytes = Buffer.byteLength(text, "utf-8")
      if (totalLines <= limits.maxLines && totalBytes <= limits.maxBytes)
        return { ...result, metadata: { ...result.metadata, truncated: false } }

      // Keep both ends: the head carries setup/context, the tail carries the result (often an error) that matters most.
      // Head takes at most half of each limit first so the tail is guaranteed a share; the head gets the rest back.
      const headEnd = Math.min(
        afterLines(text, Math.ceil(limits.maxLines / 2)),
        byteBoundary(text, Math.floor(limits.maxBytes / 2)),
      )
      const head = withoutTrailingLineBreak(text.slice(0, headEnd))
      const headLines = countLines(text.slice(0, headEnd))
      const headBytes = Buffer.byteLength(head, "utf-8")
      const tailLimit = text.endsWith("\r\n") ? text.length - 2 : text.endsWith("\n") ? text.length - 1 : text.length
      const tailStartAt = (count: number) => afterLines(text, totalLines - count)
      const tailFits = (count: number) => {
        const start = tailStartAt(count)
        return (
          start >= headEnd &&
          start < tailLimit &&
          Buffer.byteLength(text.slice(start, tailLimit), "utf-8") <= limits.maxBytes - headBytes
        )
      }
      let low = 0
      let high = Math.max(0, Math.min(limits.maxLines - headLines, totalLines - headLines))
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (tailFits(middle)) low = middle
        else high = middle - 1
      }
      const tailLines = low
      const tailStart = tailLines > 0 ? tailStartAt(tailLines) : text.length
      const tailBytes =
        tailLines > 0 ? Buffer.byteLength(text.slice(tailStart, tailLimit), "utf-8") : 0

      // Give the head the rest of the byte and line budget once the tail is fixed, but never past the tail.
      const end = Math.min(
        afterLines(text, limits.maxLines - tailLines),
        byteBoundary(text, Math.max(0, limits.maxBytes - tailBytes)),
        tailStart,
      )
      const shown = withoutTrailingLineBreak(text.slice(0, end))
      // Counted before the final line break is stripped, so a blank last line still counts.
      const shownLines = countLines(text.slice(0, end))
      const headLineCut =
        shownLines > 0 &&
        shown.length < text.length &&
        !text.startsWith("\n", shown.length) &&
        !text.startsWith("\r\n", shown.length)

      const file = path.join(directory, fileName())
      const failure = yield* fs.ensureDir(directory).pipe(
        Effect.andThen(fs.writeFileString(file, text)),
        Effect.as(undefined),
        Effect.catch((error) =>
          Effect.logWarning("failed to save full tool output", { file, cause: error }).pipe(Effect.as(describe(error))),
        ),
      )
      const headRange = shownLines > 0 ? `1-${shownLines}` : ""
      const tailRange = tailLines > 0 ? `${totalLines - tailLines + 1}-${totalLines}` : ""
      const kept = [headRange, tailRange].filter(Boolean)
      const lineRange = kept.length > 0 ? `lines ${kept.join(" and ")}` : "0 lines"
      const cut = headLineCut ? (tailLines > 0 ? " (head line cut)" : " (last line cut)") : ""
      const marker = `[showing ${lineRange} of ${totalLines}${cut}; ${
        failure === undefined ? `full output saved to ${file}` : `full output could not be saved: ${failure}`
      }]`
      const bounded: Tool.Content[] = []
      let marked = false
      content.forEach((item, index) => {
        if (item.type === "file") {
          bounded.push(item)
          return
        }
        const span = ranges.find((candidate) => candidate.index === index)
        if (!span) return
        const headPart = text.slice(span.start, Math.min(span.end, shown.length))
        // Keep empty parts that sit inside the preview, the way the whole parts were kept before.
        if (headPart || (span.end <= shown.length && item.text === "")) bounded.push({ ...item, text: headPart })
        // Mark the first text item after the head; an empty item at the boundary needs the explicit start check.
        if (!marked && (shown.length < span.end || shown.length <= span.start)) {
          bounded.push({ type: "text", text: marker })
          marked = true
        }
        if (tailLines > 0) {
          const tailPart = text.slice(Math.max(span.start, tailStart), span.end)
          if (tailPart) bounded.push({ ...item, text: tailPart })
        }
      })
      if (!marked) bounded.push({ type: "text", text: marker })
      return {
        ...result,
        content: bounded,
        metadata: { ...result.metadata, truncated: true, ...(failure === undefined && { outputPath: file }) },
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
function countLines(text: string) {
  if (text === "") return 0
  let count = 1
  for (let index = text.indexOf("\n"); index !== -1 && index < text.length - 1; index = text.indexOf("\n", index + 1))
    count++
  return count
}

/** `text` without a final line break, so a preview never ends on one. */
function withoutTrailingLineBreak(text: string) {
  return text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text
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
