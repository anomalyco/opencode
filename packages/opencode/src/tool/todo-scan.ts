import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { InstanceState } from "@/effect/instance-state"
import { SessionCwd } from "./session-cwd"

const DESCRIPTION = [
  "Scan the codebase for code-comment markers (TODO, FIXME, HACK, XXX, BUG) and list them grouped by file.",
  "Respects .gitignore. Use this to find outstanding work or tech-debt notes across the repo.",
  "Optionally narrow with an `include` glob (e.g. \"*.ts\").",
].join("\n")

export const Parameters = Schema.Struct({
  include: Schema.optional(Schema.String).annotate({
    description: 'Glob to limit which files are scanned (e.g. "*.ts", "*.{ts,tsx}")',
  }),
  markers: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Markers to search for. Defaults to TODO, FIXME, HACK, XXX, BUG.",
  }),
})

export const TodoScanTool = Tool.define(
  "todo_scan",
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, ins.directory)
          const markers = args.markers && args.markers.length > 0 ? args.markers : ["TODO", "FIXME", "HACK", "XXX", "BUG"]
          const pattern = `\\b(${markers.join("|")})\\b`

          yield* ctx.ask({
            permission: "grep",
            patterns: [pattern],
            always: ["*"],
            metadata: { markers, include: args.include },
          })

          const matches = yield* ripgrep
            .grep({ cwd, pattern, include: args.include, limit: 500 })
            .pipe(Effect.catch(() => Effect.succeed([])))

          if (matches.length === 0) {
            return { title: "todo_scan: 0", metadata: { count: 0, files: 0 }, output: "No markers found." }
          }

          const byFile = new Map<string, { line: number; text: string }[]>()
          for (const m of matches) {
            const abs = path.resolve(cwd, m.entry.path)
            const rel = path.relative(ins.worktree, abs)
            const list = byFile.get(rel) ?? []
            list.push({ line: m.line, text: m.text.trim() })
            byFile.set(rel, list)
          }

          const lines = [`Found ${matches.length} marker${matches.length === 1 ? "" : "s"} in ${byFile.size} file(s):`, ""]
          for (const [file, items] of byFile) {
            lines.push(`${file}:`)
            for (const item of items) lines.push(`  ${item.line}: ${item.text}`)
            lines.push("")
          }

          return {
            title: `todo_scan: ${matches.length}`,
            metadata: { count: matches.length, files: byFile.size },
            output: lines.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
