import { NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, Layer, Schedule, ServiceMap } from "effect"
import path from "path"
import type { Agent } from "../agent/agent"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { evaluate } from "@/permission/evaluate"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"
import { Config } from "@/config/config"

export namespace Truncate {
  const log = Log.create({ service: "truncation" })
  const RETENTION = Duration.days(7)

  export const MAX_LINES = 2000
  export const MAX_BYTES = 50 * 1024
  export const MAX_LINE_BYTES = 4096
  export const DIR = TRUNCATION_DIR
  export const GLOB = path.join(TRUNCATION_DIR, "*")

  export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    maxLineBytes?: number
    direction?: "head" | "tail"
  }

  function pruneLine(line: string, max: number): string {
    if (Buffer.byteLength(line, "utf-8") <= max) return line
    const half = Math.floor((max - 3) / 2)
    let head = 0
    let tail = line.length
    let bytes = 0
    while (head < line.length && bytes < half) {
      const code = line.codePointAt(head)!
      const size = code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1
      if (bytes + size > half) break
      bytes += size
      head += code > 0xffff ? 2 : 1
    }
    bytes = 0
    while (tail > head && bytes < half) {
      const prev = line.codePointAt(tail - 1)!
      const code = prev >= 0xdc00 && prev <= 0xdfff && tail >= 2 ? line.codePointAt(tail - 2)! : prev
      const size = code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1
      if (bytes + size > half) break
      bytes += size
      tail -= code > 0xffff ? 2 : 1
    }
    return line.substring(0, head) + "…" + line.substring(tail)
  }

  function hasTaskTool(agent?: Agent.Info) {
    if (!agent?.permission) return false
    return evaluate("task", "*", agent.permission).action !== "deny"
  }

  export interface Interface {
    readonly cleanup: () => Effect.Effect<void>
    /**
     * Returns output unchanged when it fits within the limits, otherwise writes the full text
     * to the truncation directory and returns a preview plus a hint to inspect the saved file.
     */
    readonly output: (text: string, options?: Options, agent?: Agent.Info) => Effect.Effect<Result>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Truncate") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service

      const cleanup = Effect.fn("Truncate.cleanup")(function* () {
        const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - Duration.toMillis(RETENTION)))
        const entries = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
          Effect.map((all) => all.filter((name) => name.startsWith("tool_"))),
          Effect.catch(() => Effect.succeed([])),
        )
        for (const entry of entries) {
          if (Identifier.timestamp(entry) >= cutoff) continue
          yield* fs.remove(path.join(TRUNCATION_DIR, entry)).pipe(Effect.catch(() => Effect.void))
        }
      })

      const output = Effect.fn("Truncate.output")(function* (text: string, options: Options = {}, agent?: Agent.Info) {
        const maxLines = options.maxLines ?? MAX_LINES
        const maxBytes = options.maxBytes ?? MAX_BYTES
        const maxLine = options.maxLineBytes ?? MAX_LINE_BYTES
        const direction = options.direction ?? "head"
        const lines = text.split("\n")
        const totalBytes = Buffer.byteLength(text, "utf-8")

        if (lines.length <= maxLines && totalBytes <= maxBytes) {
          let wide = false
          for (const line of lines) {
            if (Buffer.byteLength(line, "utf-8") > maxLine) {
              wide = true
              break
            }
          }
          if (!wide) return { content: text, truncated: false } as const
        }

        const out: string[] = []
        let i = 0
        let bytes = 0
        let hitBytes = false

        if (direction === "head") {
          for (i = 0; i < lines.length && i < maxLines; i++) {
            const pruned = pruneLine(lines[i], maxLine)
            const size = Buffer.byteLength(pruned, "utf-8") + (i > 0 ? 1 : 0)
            if (bytes + size > maxBytes) {
              hitBytes = true
              break
            }
            out.push(pruned)
            bytes += size
          }
        } else {
          for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
            const pruned = pruneLine(lines[i], maxLine)
            const size = Buffer.byteLength(pruned, "utf-8") + (out.length > 0 ? 1 : 0)
            if (bytes + size > maxBytes) {
              hitBytes = true
              break
            }
            out.unshift(pruned)
            bytes += size
          }
        }

        const preview = out.join("\n")
        const allKept = !hitBytes && out.length === lines.length
        if (allKept) {
          return { content: preview, truncated: false } as const
        }

        const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
        const unit = hitBytes ? "bytes" : "lines"
        const file = path.join(TRUNCATION_DIR, ToolID.ascending())

        yield* fs.ensureDir(TRUNCATION_DIR).pipe(Effect.orDie)
        yield* fs.writeFileString(file, text).pipe(Effect.orDie)

        const hint = hasTaskTool(agent)
          ? `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
          : `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

        return {
          content:
            direction === "head"
              ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
              : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`,
          truncated: true,
          outputPath: file,
        } as const
      })

      yield* cleanup().pipe(
        Effect.catchCause((cause) => {
          log.error("truncation cleanup failed", { cause: Cause.pretty(cause) })
          return Effect.void
        }),
        Effect.repeat(Schedule.spaced(Duration.hours(1))),
        Effect.delay(Duration.minutes(1)),
        Effect.forkScoped,
      )

      return Service.of({ cleanup, output })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer), Layer.provide(NodePath.layer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    const cfg = await Config.get().catch(() => undefined)
    const merged: Options = {
      maxLines: options.maxLines ?? cfg?.truncation?.max_lines,
      maxBytes: options.maxBytes ?? cfg?.truncation?.max_bytes,
      maxLineBytes: options.maxLineBytes ?? cfg?.truncation?.max_line_bytes,
      direction: options.direction,
    }
    return runPromise((s) => s.output(text, merged, agent))
  }
}
