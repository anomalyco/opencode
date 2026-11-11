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

      const file = path.join(directory, fileName())
      yield* fs.ensureDir(directory).pipe(Effect.orDie)
      yield* fs.writeFileString(file, text).pipe(Effect.orDie)

      // Keep both ends: the head carries setup/context, the tail carries the result (often an error) that matters most.
      // When the marker alone would not fit, keep the old behavior and give the whole byte budget to content.
      const markerBytes = Buffer.byteLength(
        `[showing lines ${lines.length}-${lines.length} and ${lines.length}-${lines.length} of ${lines.length}; full output saved to ${file}]`,
        "utf-8",
      )
      const budget = markerBytes + 2 <= limits.maxBytes ? limits.maxBytes - markerBytes - 2 : limits.maxBytes
      const headBudget = Math.floor(budget / 2)
      const headLineBudget = Math.ceil(limits.maxLines / 2)

      const head: string[] = []
      let headBytes = 0
      for (const line of lines.slice(0, headLineBudget)) {
        const size = Buffer.byteLength(line, "utf-8") + (head.length > 0 ? 1 : 0)
        if (headBytes + size > headBudget) break
        head.push(line)
        headBytes += size
      }

      const tail: string[] = []
      let tailBytes = 0
      const tailLineBudget = limits.maxLines - head.length
      for (let i = lines.length - 1; i >= head.length && tail.length < tailLineBudget; i--) {
        const line = lines[i]
        const size = Buffer.byteLength(line, "utf-8") + (tail.length > 0 ? 1 : 0)
        if (tailBytes + size > budget - headBytes) break
        tail.unshift(line)
        tailBytes += size
      }

      const tailStart = lines.length - tail.length

      // The tail often ends early (a single oversized line), so give the head whatever budget is left.
      for (let i = head.length; i < tailStart && head.length + tail.length < limits.maxLines; i++) {
        const line = lines[i]
        const size = Buffer.byteLength(line, "utf-8") + (head.length > 0 ? 1 : 0)
        if (headBytes + tailBytes + size > budget) break
        head.push(line)
        headBytes += size
      }

      const shown = [
        ...(head.length > 0 ? [`1-${head.length}`] : []),
        ...(tail.length > 0 ? [`${tailStart + 1}-${lines.length}`] : []),
      ].join(" and ")
      const marker = `[showing ${shown ? `lines ${shown}` : "0 lines"} of ${lines.length}; full output saved to ${file}]`

      // Each kept line goes back into the text item it came from, so attachments stay between the same lines.
      const ranges: { index: number; start: number; end: number }[] = []
      let lineIndex = 0
      content.forEach((item, index) => {
        if (item.type !== "text") return
        const start = lineIndex
        lineIndex += item.text.split("\n").length
        ranges.push({ index, start, end: lineIndex })
      })
      if (text.endsWith("\n") && ranges.length > 0) ranges[ranges.length - 1].end -= 1

      const markerIndex =
        head.length > 0
          ? ranges.find((range) => head.length - 1 >= range.start && head.length - 1 < range.end)?.index
          : ranges[0]?.index
      const bounded: Tool.Content[] = []
      let marked = false
      content.forEach((item, index) => {
        if (item.type === "file") {
          bounded.push(item)
          return
        }
        const range = ranges.find((candidate) => candidate.index === index)
        if (!range) return
        const parts: string[] = []
        const headLines = lines.slice(range.start, Math.min(range.end, head.length))
        if (headLines.length > 0) parts.push(headLines.join("\n"))
        if (!marked && (markerIndex === undefined || markerIndex === index)) {
          parts.push(marker)
          marked = true
        }
        if (tail.length > 0) {
          const tailLines = lines.slice(Math.max(range.start, tailStart), range.end)
          if (tailLines.length > 0) parts.push(tailLines.join("\n"))
        }
        const itemText = parts.filter((part) => part.length > 0).join("\n")
        if (itemText) bounded.push({ ...item, text: itemText })
      })
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
