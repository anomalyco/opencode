export * as ToolTruncation from "./tool-truncation"

import path from "path"
import type { Tool } from "@opencode-ai/schema/tool"
import { Context, Duration, Effect, Layer, Option, Schedule } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
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
  readonly apply: (result: Result) => Effect.Effect<Result>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolTruncation") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const directory = path.join(global.data, DIRECTORY)

    const cleanup = Effect.fn("ToolTruncation.cleanup")(function* () {
      const entries = yield* fs.readDirectory(directory).pipe(Effect.catch(() => Effect.succeed([])))
      const cutoff = Date.now() - Duration.toMillis(RETENTION)
      yield* Effect.forEach(
        entries.filter((entry) => entry.startsWith("tool_")),
        (entry) => {
          const file = path.join(directory, entry)
          return fs.stat(file).pipe(
            Effect.flatMap((info) =>
              Option.getOrElse(info.mtime, () => new Date(0)).getTime() < cutoff ? fs.remove(file) : Effect.void,
            ),
            Effect.catch(() => Effect.void),
          )
        },
        { discard: true },
      )
    })

    const apply = Effect.fn("ToolTruncation.apply")(function* (result: Result) {
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

    yield* cleanup().pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.forkScoped)
    return Service.of({ apply, cleanup })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node, FSUtil.node, Global.node] })
