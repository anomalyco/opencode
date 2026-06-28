import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"

const DESCRIPTION = [
  "Report compile/type/lint diagnostics from the language servers (LSP).",
  "",
  "Pass `filePath` to refresh and report diagnostics for a single file (the server is",
  "asked to recompute first). Omit it to report all currently-known diagnostics across",
  "the project. Relative paths resolve against the session working directory.",
  "",
  "Use this to check for errors after edits instead of running the project's typecheck via shell.",
].join("\n")

export const Parameters = Schema.Struct({
  filePath: Schema.optional(Schema.String).annotate({
    description: "Optional file to refresh and report. Omit to report all known project diagnostics.",
  }),
})

export const DiagnosticsTool = Tool.define(
  "diagnostics",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const base = SessionCwd.get(ctx.sessionID, instance.directory)

          yield* ctx.ask({
            permission: "diagnostics",
            patterns: ["*"],
            always: ["*"],
            metadata: { filePath: args.filePath },
          })

          if (args.filePath) {
            const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(base, args.filePath)
            yield* assertExternalDirectoryEffect(ctx, file)
            const exists = yield* fs.existsSafe(file)
            if (!exists) throw new Error(`File not found: ${file}`)
            const available = yield* lsp.hasClients(file)
            if (!available) {
              return {
                title: path.relative(instance.worktree, file),
                metadata: { count: 0 },
                output: "No LSP server available for this file type.",
              }
            }
            yield* lsp.touchFile(file, "full")
            const all = yield* lsp.diagnostics()
            const normalized = FSUtil.normalizePath(file)
            const block = LSP.Diagnostic.report(file, all[normalized] ?? [])
            return {
              title: path.relative(instance.worktree, file),
              metadata: { count: (all[normalized] ?? []).length },
              output: block || "No diagnostics for this file.",
            }
          }

          const all = yield* lsp.diagnostics()
          const blocks: string[] = []
          let total = 0
          for (const [file, issues] of Object.entries(all)) {
            if (!issues.length) continue
            const block = LSP.Diagnostic.report(file, issues)
            if (!block) continue
            total += issues.length
            blocks.push(block)
          }

          return {
            title: `diagnostics: ${total} issue${total === 1 ? "" : "s"}`,
            metadata: { count: total },
            output: blocks.length ? blocks.join("\n\n") : "No diagnostics reported across the project.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
