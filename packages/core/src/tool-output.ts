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
      const lines = text.split("\n")
      if (text.endsWith("\n")) lines.pop()
      const totalBytes = Buffer.byteLength(text, "utf-8")
      if (lines.length <= limits.maxLines && totalBytes <= limits.maxBytes)
        return { ...result, metadata: { ...result.metadata, truncated: false } }

      // One cut at the line or byte limit, whichever comes first, so a line too long for the space left shows its start.
      const shown = text
        .slice(0, Math.min(afterLines(text, limits.maxLines), byteBoundary(text, limits.maxBytes)))
        .replace(/\r?\n$/, "")
      const file = path.join(directory, fileName())
      const failure = yield* fs.ensureDir(directory).pipe(
        Effect.andThen(fs.writeFileString(file, text)),
        Effect.as(undefined),
        Effect.catch((error) =>
          Effect.logWarning("failed to save full tool output", { file, cause: error }).pipe(Effect.as(describe(error))),
        ),
      )
      const range = shown === "" ? "0 lines" : `lines 1-${shown.split("\n").length}`
      const cutLine =
        shown === "" || /^(\r?\n|$)/.test(text.slice(shown.length, shown.length + 2)) ? "" : " (last line cut)"
      const marker = `[showing ${range} of ${lines.length}${cutLine}; ${
        failure === undefined ? `full output saved to ${file}` : `full output could not be saved: ${failure}`
      }]`
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
  // encodeInto stops at whole code points; the segmenter then backs off to the start of the grapheme it is inside.
  const index = encoder.encodeInto(text, new Uint8Array(Math.max(0, budget))).read
  if (index === text.length) return index
  return graphemes.segment(text.slice(0, index + 2)).containing(index)?.index ?? index
}
