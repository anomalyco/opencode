export * as ToolOutput from "./tool-output.js"

import path from "path"
import type { Tool } from "@opencode-ai/schema/tool"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { FileRetention } from "./file-retention.js"
import { Identifier } from "./id/id.js"
import { State } from "./state.js"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024 // 50 KiB
export const RETENTION = Duration.days(7)
export const DIRECTORY = "tool-output"

type Result = Tool.Result

type Limits = {
  maxLines: number
  maxBytes: number
}

export type Draft = {
  configure: (limits: Partial<Limits>) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly truncate: (result: Result) => Effect.Effect<Result>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolOutput") {}

const cleanup = Effect.fn("ToolOutput.cleanup")(function* (fs: FSUtil.Interface, directory: string) {
  const entries = yield* fs.readDirectory(directory).pipe(
    Effect.map((entries) => entries.filter((entry) => /^tool_[0-9a-f]{12}/.test(entry))),
    Effect.catch(() => Effect.succeed([])),
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
    const state = State.create<Limits, Draft>({
      name: "tool-output",
      initial: () => ({ maxLines: MAX_LINES, maxBytes: MAX_BYTES }),
      draft: (draft) => ({
        configure: (limits) => {
          if (limits.maxLines !== undefined) draft.maxLines = limits.maxLines
          if (limits.maxBytes !== undefined) draft.maxBytes = limits.maxBytes
        },
      }),
    })

    const truncate = Effect.fnUntraced(function* (result: Result) {
      if (result.metadata?.truncated !== undefined) return result
      const content =
        typeof result.content === "string" ? [{ type: "text" as const, text: result.content }] : (result.content ?? [])
      const text = content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
      const limits = state.get()
      const lines = text.split("\n")
      if (text.endsWith("\n")) lines.pop()
      const totalBytes = Buffer.byteLength(text, "utf-8")
      if (lines.length <= limits.maxLines && totalBytes <= limits.maxBytes)
        return { ...result, metadata: { ...result.metadata, truncated: false } }

      const kept: string[] = []
      let bytes = 0
      let hitBytes = false
      for (const line of lines.slice(0, limits.maxLines)) {
        const size = Buffer.byteLength(line, "utf-8") + (kept.length > 0 ? 1 : 0)
        if (bytes + size > limits.maxBytes) {
          hitBytes = true
          break
        }
        kept.push(line)
        bytes += size
      }
      if (!hitBytes && kept.length === lines.length && totalBytes > bytes) hitBytes = true
      const removed = hitBytes ? totalBytes - bytes : lines.length - kept.length
      const unit = hitBytes ? (removed === 1 ? "byte" : "bytes") : removed === 1 ? "line" : "lines"
      const file = path.join(directory, Identifier.ascending("tool"))
      yield* fs.ensureDir(directory).pipe(Effect.orDie)
      yield* fs.writeFileString(file, text).pipe(Effect.orDie)
      const marker = `... ${removed} ${unit} truncated; full content saved to ${file} ...`
      const bounded: Tool.Content[] = []
      let remaining = kept.join("\n").length
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

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      truncate,
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
