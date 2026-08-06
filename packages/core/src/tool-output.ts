export * as ToolOutput from "./tool-output"

import path from "path"
import type { Tool } from "@opencode-ai/schema/tool"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Config } from "./config"
import { Identifier } from "./util/identifier"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024 // 50 KiB
export const RETENTION = Duration.days(7)
export const DIRECTORY = "tool-output"

type Result = Tool.Result

export interface Interface {
  readonly truncate: (result: Result) => Effect.Effect<Result>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolOutput") {}

const timestamp = (id: string) => Number(BigInt(`0x${id.slice(0, 12)}`) / 0x1000n)

const cleanup = Effect.fn("ToolOutput.cleanup")(function* (fs: FSUtil.Interface, directory: string) {
  const cutoff = timestamp(Identifier.create(false, Date.now() - Duration.toMillis(RETENTION)))
  const entries = yield* fs.readDirectory(directory).pipe(
    Effect.map((entries) => entries.filter((entry) => /^tool_[0-9a-f]{12}/.test(entry))),
    Effect.catch(() => Effect.succeed([])),
  )
  for (const entry of entries) {
    if (timestamp(entry.slice("tool_".length)) >= cutoff) continue
    yield* fs.remove(path.join(directory, entry)).pipe(Effect.catch(() => Effect.void))
  }
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const directory = path.join(global.data, DIRECTORY)

    const truncate = Effect.fn("ToolOutput.truncate")(function* (result: Result) {
      if (result.metadata?.truncated === true) return result
      const content =
        typeof result.content === "string" ? [{ type: "text" as const, text: result.content }] : (result.content ?? [])
      const text = content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
      const configured = Config.latest(yield* config.entries(), "tool_output")
      const maxLines = configured?.max_lines ?? MAX_LINES
      const maxBytes = configured?.max_bytes ?? MAX_BYTES
      const lines = text.split("\n")
      if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes)
        return { ...result, metadata: { ...result.metadata, truncated: false } }

      const kept: string[] = []
      let bytes = 0
      for (const line of lines.slice(0, maxLines)) {
        const size = Buffer.byteLength(line, "utf-8") + (kept.length > 0 ? 1 : 0)
        if (bytes + size > maxBytes) break
        kept.push(line)
        bytes += size
      }
      const file = path.join(directory, `tool_${Identifier.ascending()}`)
      yield* fs.ensureDir(directory).pipe(Effect.orDie)
      yield* fs.writeFileString(file, text).pipe(Effect.orDie)
      return {
        ...result,
        content: [
          {
            type: "text" as const,
            text: `${kept.join("\n")}\n\n... output truncated; full content saved to ${file} ...`,
          },
          ...content.filter((item) => item.type === "file"),
        ],
        metadata: { ...result.metadata, truncated: true, outputPath: file },
      }
    })

    return Service.of({ truncate, cleanup: () => cleanup(fs, directory) })
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

const cleanupNode = makeGlobalNode({ name: "tool-output-cleanup", layer: cleanupLayer, deps: [FSUtil.node, Global.node] })

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node, Global.node, cleanupNode],
})
