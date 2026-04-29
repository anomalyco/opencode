import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import path from "path"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "The LSP operation to perform" }),
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  line: Schema.Number.check(Schema.isInt())
    .check(Schema.isGreaterThanOrEqualTo(1))
    .annotate({ description: "The line number (1-based, as shown in editors)" }),
  character: Schema.Number.check(Schema.isInt())
    .check(Schema.isGreaterThanOrEqualTo(1))
    .annotate({ description: "The character offset (1-based, as shown in editors)" }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query for workspaceSymbol. Empty string requests all symbols.",
  }),
})

export const LspTool = Tool.define(
  "lsp",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
          yield* assertExternalDirectoryEffect(ctx, file)
          const meta =
            args.operation === "workspaceSymbol"
              ? { operation: args.operation }
              : args.operation === "documentSymbol"
                ? { operation: args.operation, filePath: file }
                : { operation: args.operation, filePath: file, line: args.line, character: args.character }
          yield* ctx.ask({
            permission: "lsp",
            patterns: ["*"],
            always: ["*"],
            metadata: meta,
          })

          const uri = pathToFileURL(file).href
          const position = { file, line: args.line - 1, character: args.character - 1 }
          const relPath = path.relative(Instance.worktree, file)
          const detail =
            args.operation === "workspaceSymbol"
              ? ""
              : args.operation === "documentSymbol"
                ? relPath
                : `${relPath}:${args.line}:${args.character}`
          const title = detail ? `${args.operation} ${detail}` : args.operation

          const exists = yield* fs.existsSafe(file)
          if (!exists) throw new Error(`File not found: ${file}`)

          const available = yield* lsp.hasClients(file)
          if (!available) throw new Error("No LSP server available for this file type.")

          yield* lsp.touchFile(file, "document")

          const result: unknown[] = yield* (() => {
            switch (args.operation) {
              case "goToDefinition":
                return lsp.definition(position)
              case "findReferences":
                return lsp.references(position)
              case "hover":
                return lsp.hover(position)
              case "documentSymbol":
                return lsp.documentSymbol(uri)
              case "workspaceSymbol":
                return lsp.workspaceSymbol(args.query ?? "")
              case "goToImplementation":
                return lsp.implementation(position)
              case "prepareCallHierarchy":
                return lsp.prepareCallHierarchy(position)
              case "incomingCalls":
                return lsp.incomingCalls(position)
              case "outgoingCalls":
                return lsp.outgoingCalls(position)
            }
          })()

          return {
            title,
            metadata: { result },
            output: result.length === 0 ? `No results found for ${args.operation}` : JSON.stringify(result, null, 2),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
