import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"

const DESCRIPTION = [
  "Find-and-replace across many files in one call (regex or literal).",
  "",
  "Finds candidate files with ripgrep (respecting .gitignore), then applies the replacement to each.",
  "Use `include` to limit by glob (e.g. \"*.ts\"), `literal=true` to treat `search` as plain text,",
  "and `dryRun=true` to preview affected files without writing.",
  "For a single targeted edit prefer `edit`/`multiedit`; use this for repo-wide renames/replacements.",
].join("\n")

export const Parameters = Schema.Struct({
  search: Schema.String.annotate({ description: "Regex (or literal text if literal=true) to find" }),
  replace: Schema.String.annotate({ description: "Replacement text. Supports $1, $2 capture groups for regex." }),
  include: Schema.optional(Schema.String).annotate({ description: 'Glob to limit files (e.g. "*.ts")' }),
  literal: Schema.optional(Schema.Boolean).annotate({ description: "Treat search as literal text (default false)" }),
  dryRun: Schema.optional(Schema.Boolean).annotate({ description: "Preview affected files without writing" }),
})

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export const BulkEditTool = Tool.define(
  "bulk_edit",
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!args.search) throw new Error("search is required")
          const ins = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, ins.directory)

          const finder = args.literal ? escapeRegex(args.search) : args.search
          const regex = ((): RegExp => {
            try {
              return new RegExp(args.literal ? escapeRegex(args.search) : args.search, "g")
            } catch (err) {
              throw new Error(`Invalid regex: ${(err as Error).message}`)
            }
          })()

          yield* ctx.ask({
            permission: "edit",
            patterns: [args.search],
            always: ["*"],
            metadata: { search: args.search, replace: args.replace, include: args.include, dryRun: args.dryRun === true },
          })

          const matches = yield* ripgrep
            .grep({ cwd, pattern: finder, include: args.include, limit: 1000 })
            .pipe(Effect.catch(() => Effect.succeed([])))

          const files = [...new Set(matches.map((m) => path.resolve(cwd, m.entry.path)))]
          if (files.length === 0) {
            return { title: "bulk_edit: 0 files", metadata: { changed: 0, candidates: 0 }, output: "No files matched." }
          }

          if (args.dryRun) {
            const rels = files.map((f) => path.relative(ins.worktree, f))
            return {
              title: `bulk_edit (dry-run): ${files.length} file(s)`,
              metadata: { changed: 0, candidates: files.length },
              output: ["Would edit:", ...rels.map((r) => `  ${r}`)].join("\n"),
            }
          }

          let changedCount = 0
          const changed: string[] = []
          for (const file of files) {
            yield* assertExternalDirectoryEffect(ctx, file)
            const original = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (original === undefined) continue
            regex.lastIndex = 0
            const next = original.replace(regex, args.replace)
            if (next === original) continue
            yield* fs.writeWithDirs(file, next).pipe(Effect.orDie)
            yield* events.publish(FileSystem.Event.Edited, { file })
            yield* events.publish(Watcher.Event.Updated, { file, event: "change" })
            changedCount++
            changed.push(path.relative(ins.worktree, file))
          }

          return {
            title: `bulk_edit: ${changedCount} file(s)`,
            metadata: { changed: changedCount, candidates: files.length },
            output:
              changedCount === 0
                ? "No files were modified (matches found but replacement produced no change)."
                : ["Edited:", ...changed.map((r) => `  ${r}`)].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
