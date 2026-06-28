import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"

const DESCRIPTION = [
  "Format one or more files using the project's configured formatters (prettier, ruff, gofmt, etc.).",
  "",
  "Relative paths resolve against the session working directory (see change_directory).",
  "Returns which files were formatted and which had no matching formatter configured.",
  "Use this after editing when you want to normalize style without running the formatter via shell.",
].join("\n")

export const Parameters = Schema.Struct({
  paths: Schema.Array(Schema.String).annotate({
    description: "Absolute or relative file paths to format",
  }),
})

export const FormatTool = Tool.define(
  "format",
  Effect.gen(function* () {
    const format = yield* Format.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const base = SessionCwd.get(ctx.sessionID, instance.directory)

          const resolved = params.paths.map((p) => (path.isAbsolute(p) ? p : path.join(base, p)))
          for (const filepath of resolved) {
            yield* assertExternalDirectoryEffect(ctx, filepath)
          }

          yield* ctx.ask({
            permission: "format",
            patterns: resolved.map((f) => path.relative(instance.worktree, f)),
            always: ["*"],
            metadata: { paths: resolved },
          })

          const formatted: string[] = []
          const skipped: string[] = []
          for (const filepath of resolved) {
            const did = yield* format.file(filepath)
            const rel = path.relative(instance.worktree, filepath)
            if (did) formatted.push(rel)
            else skipped.push(rel)
          }

          const lines: string[] = []
          if (formatted.length) lines.push(`Formatted (${formatted.length}):`, ...formatted.map((f) => `  ${f}`))
          if (skipped.length) lines.push(`No formatter configured (${skipped.length}):`, ...skipped.map((f) => `  ${f}`))

          return {
            title: `format ${params.paths.length} file${params.paths.length === 1 ? "" : "s"}`,
            metadata: { formatted, skipped },
            output: lines.length ? lines.join("\n") : "Nothing to format.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
