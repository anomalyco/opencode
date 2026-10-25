import path from "path"
import { fileURLToPath } from "url"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./lsp-references.txt"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@bolt-ai/core/fs-util"

type Location = { uri: string; range: { start: { line: number; character: number } } }

export function render(locations: Location[], root: string) {
  return locations
    .map((item) => ({
      file: path.relative(root, fileURLToPath(item.uri)) || item.uri,
      line: item.range.start.line + 1,
      column: item.range.start.character + 1,
    }))
    .toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
    .map((item) => `${item.file}:${item.line}:${item.column}`)
}

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The line number of the symbol (1-based, as shown in editors)",
  }),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The character offset of the symbol (1-based, as shown in editors)",
  }),
})

export const LspReferencesTool = Tool.define(
  "lsp_references",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
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
            permission: "lsp",
            patterns: ["*"],
            always: ["*"],
            metadata: { operation: "references", filePath: file, line: args.line, character: args.character },
          })

          const exists = yield* fs.existsSafe(file)
          if (!exists) throw new Error(`File not found: ${file}`)

          const available = yield* lsp.hasClients(file)
          if (!available) throw new Error("No LSP server available for this file type.")

          yield* lsp.touchFile(file, "document")
          const locations = yield* lsp.references({ file, line: args.line - 1, character: args.character - 1 })
          const lines = render(locations, instance.worktree)

          return {
            title: `references ${detail}`,
            metadata: { count: lines.length },
            output:
              lines.length === 0
                ? "No references found."
                : [`${lines.length} reference${lines.length === 1 ? "" : "s"}:`, ...lines].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
