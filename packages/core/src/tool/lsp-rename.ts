import path from "path"
import { fileURLToPath } from "url"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import { WorkspaceEdit } from "@/lsp/workspace-edit"
import DESCRIPTION from "./lsp-rename.txt"
import { InstanceState } from "@/effect/instance-state"
import { containsPath } from "@/project/instance-context"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@bolt-ai/core/fs-util"
import { FileSystem } from "@bolt-ai/core/filesystem"
import { Watcher } from "@bolt-ai/core/filesystem/watcher"
import { EventV2Bridge } from "@/event-v2-bridge"

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The line number of the symbol (1-based, as shown in editors)",
  }),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The character offset of the symbol (1-based, as shown in editors)",
  }),
  newName: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "The new name for the symbol" }),
})

export const LspRenameTool = Tool.define(
  "lsp_rename",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(instance.directory, args.filePath)
          yield* assertExternalDirectoryEffect(ctx, file)

          const detail = `${path.relative(instance.worktree, file)}:${args.line}:${args.character}`
          yield* ctx.ask({
            permission: "edit",
            patterns: ["*"],
            always: ["*"],
            metadata: {
              operation: "rename",
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
          const results = yield* lsp.rename({ file, line: args.line - 1, character: args.character - 1 }, args.newName)
          const merged = results.map((item) => WorkspaceEdit.collect(item)).find((item) => Object.keys(item).length > 0)
          if (!merged) {
            return {
              title: `rename ${detail}`,
              metadata: { files: 0, edits: 0 },
              output: "The language server returned no rename edits. Check the position points at a renameable symbol.",
            }
          }

          const edited: { file: string; edits: number }[] = []
          yield* Effect.forEach(Object.keys(merged), (uri) =>
            Effect.gen(function* () {
              const target = fileURLToPath(uri)
              // Never write outside the project, even if a server suggests it.
              if (!containsPath(target, instance)) return
              const content = yield* fs.readFileStringSafe(target)
              if (content === undefined) return
              yield* fs.writeWithDirs(target, WorkspaceEdit.apply(content, merged[uri]))
              yield* events.publish(FileSystem.Event.Edited, { file: target })
              yield* events.publish(Watcher.Event.Updated, { file: target, event: "add" })
              yield* lsp.touchFile(target)
              edited.push({ file: path.relative(instance.worktree, target) || target, edits: merged[uri].length })
            }),
          )

          if (edited.length === 0) {
            return {
              title: `rename ${detail}`,
              metadata: { files: 0, edits: 0 },
              output: "The rename produced no applicable edits inside the project.",
            }
          }

          const total = edited.reduce((sum, item) => sum + item.edits, 0)
          const lines = edited
            .toSorted((a, b) => a.file.localeCompare(b.file))
            .map((item) => `${item.file} (${item.edits} edit${item.edits === 1 ? "" : "s"})`)
          return {
            title: `rename ${detail} -> ${args.newName}`,
            metadata: { files: edited.length, edits: total },
            output: [
              `Renamed to ${args.newName} in ${edited.length} file${edited.length === 1 ? "" : "s"} (${total} edit${total === 1 ? "" : "s"}):`,
              ...lines,
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
