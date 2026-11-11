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
      const text = content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
      const limits = state.get()
      const lines = text.split("\n")
      if (text.endsWith("\n")) lines.pop()
      const totalBytes = Buffer.byteLength(text, "utf-8")
      if (lines.length <= limits.maxLines && totalBytes <= limits.maxBytes)
        return { ...result, metadata: { ...result.metadata, truncated: false } }

      // One cut: the end of the last line allowed, or the byte limit, whichever comes first. A line longer than what
      // is left (a long log line, or a whole JSON result on one line) shows its start instead of vanishing.
      const byLines = lineEnd(text, limits.maxLines)
      const cut = Math.min(byLines, byteBoundary(text, limits.maxBytes))
      const shown = text.slice(0, cut)
      const file = path.join(directory, fileName())
      yield* fs.ensureDir(directory).pipe(Effect.orDie)
      yield* fs.writeFileString(file, text).pipe(Effect.orDie)
      const shownLines = shown === "" ? 0 : shown.split("\n").length
      const lineCut = cut < text.length && text[cut] !== "\n"
      const marker =
        cut === byLines
          ? `[showing lines 1-${shownLines} of ${lines.length}; full output saved to ${file}]`
          : `[showing ${Buffer.byteLength(shown, "utf-8")} of ${totalBytes} bytes (${shownLines === 0 ? "0 lines" : `lines 1-${shownLines}`} of ${lines.length}${lineCut ? ", last line cut" : ""}); full output saved to ${file}]`
      const bounded: Tool.Content[] = []
      let remaining = shown.length
      let seenText = false
      let marked = false
      for (const item of content) {
        if (item.type === "file") {
          bounded.push(item)
          continue
        }
        if (seenText && remaining > 0) remaining--
        seenText = true
        if (remaining >= item.text.length) {
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
        metadata: { ...result.metadata, truncated: true, outputPath: file },
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

/** The index just before the newline that ends line `count`, or the end of `text` when it has no more lines. */
function lineEnd(text: string, count: number) {
  let index = -1
  for (let line = 0; line < count; line++) {
    index = text.indexOf("\n", index + 1)
    if (index === -1) return text.length
  }
  return index
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * The longest prefix of `text`, as a string index, that fits in `budget` UTF-8 bytes and ends between user-perceived
 * characters, so a cut never splits a code point, a surrogate pair, or a multi-code-point emoji (ZWJ sequences, skin
 * tones, flags, keycaps).
 */
function byteBoundary(text: string, budget: number) {
  const bytes = Buffer.from(text, "utf-8")
  if (bytes.length <= budget) return text.length
  let end = Math.max(0, budget)
  // Back up over UTF-8 continuation bytes to a code point boundary.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
  const index = bytes.subarray(0, end).toString("utf-8").length
  // Then back up to a grapheme boundary. Clusters are short, so a window before the cut is enough to find it.
  const start = Math.max(0, index - 64)
  const boundaries = Array.from(graphemes.segment(text.slice(start, index + 64)), (segment) => start + segment.index)
  return boundaries.findLast((boundary) => boundary <= index) ?? index
}
