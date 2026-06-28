import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { SessionCwd } from "./session-cwd"
import { applyWorkspaceEdit } from "./apply-workspace-edit"

const DESCRIPTION = [
  "Rename a symbol everywhere it is used, via the language server (LSP rename).",
  "",
  "Point at any occurrence of the symbol with filePath + line + character (1-based, as shown in editors).",
  "The LSP computes a workspace-wide edit and this tool applies it across all affected files.",
  "Safer and more complete than find/replace: it understands scopes and only renames real references.",
  "Requires an LSP server for the file's language.",
].join("\n")

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "Absolute or relative path to a file containing the symbol" }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({ description: "Line of the symbol (1-based)" }),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "Character offset of the symbol (1-based)",
  }),
  newName: Schema.String.annotate({ description: "The new name for the symbol" }),
})

export const RenameSymbolTool = Tool.define(
  "rename_symbol",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!args.newName.trim()) throw new Error("newName is required")
          const ins = yield* InstanceState.context
          const file = path.isAbsolute(args.filePath)
            ? args.filePath
            : path.join(SessionCwd.get(ctx.sessionID, ins.directory), args.filePath)

          yield* assertExternalDirectoryEffect(ctx, file)
          yield* ctx.ask({
            permission: "edit",
            patterns: ["*"],
            always: ["*"],
            metadata: {
              filePath: file,
              line: args.line,
              character: args.character,
              newName: args.newName,
            },
          })

          const exists = yield* fs.existsSafe(file)
          if (!exists) throw new Error(`File not found: ${file}`)
          const available = yield* lsp.hasClients(file)
          if (!available) throw new Error("No LSP server available for this file type.")

          yield* lsp.touchFile(file, "document")

          const edit = yield* lsp.rename({
            file,
            line: args.line - 1,
            character: args.character - 1,
            newName: args.newName,
          })
          if (!edit) {
            throw new Error("The language server returned no rename edit (symbol not renamable at that position).")
          }

          const changed = yield* applyWorkspaceEdit(edit, fs, events)
          if (changed.length === 0) {
            return {
              title: `rename_symbol: no changes`,
              metadata: { changed: 0 },
              output: "The rename produced no file changes.",
            }
          }

          const rels = changed.map((f) => path.relative(ins.worktree, f))
          return {
            title: `rename_symbol → ${args.newName} (${changed.length} file${changed.length === 1 ? "" : "s"})`,
            metadata: { changed: changed.length },
            output: [`Renamed to "${args.newName}" across ${changed.length} file(s):`, ...rels.map((r) => `  ${r}`)].join(
              "\n",
            ),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
