import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import path from "path"
import { LSP } from "../lsp"
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
  filePath: Schema.optional(Schema.String).annotate({ description: "The absolute or relative path to the file. Required for all operations except workspaceSymbol." }),
  line: Schema.optional(Schema.Number).annotate({ description: "The line number (1-based, as shown in editors). Required for: goToDefinition, findReferences, hover, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls." }),
  character: Schema.optional(Schema.Number).annotate({ description: "The character offset (1-based, as shown in editors). Required for: goToDefinition, findReferences, hover, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls." }),
  query: Schema.optional(Schema.String).annotate({ description: "Search query. Required for workspaceSymbol operation." }),
})

export const LspTool = Tool.define(
  "lsp",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        args: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          if (args.operation === "workspaceSymbol") {
            if (!args.query) {
              throw new Error(`query is required for operation '${args.operation}'`)
            }
            const result: unknown[] = yield* lsp.workspaceSymbol(args.query)
            return {
              title: `workspaceSymbol "${args.query}"`,
              metadata: { result },
              output: result.length === 0 ? `No workspace symbols found matching query "${args.query}"` : JSON.stringify(result, null, 2),
            }
          }

          if (!args.filePath) {
            throw new Error(`filePath is required for operation '${args.operation}'`)
          }

          const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
          yield* assertExternalDirectoryEffect(ctx, file)
          const meta =
            args.operation === "documentSymbol"
              ? { operation: args.operation, filePath: file }
              : { operation: args.operation, filePath: file, line: args.line, character: args.character }
          yield* ctx.ask({
            permission: "lsp",
            patterns: ["*"],
            always: ["*"],
            metadata: meta,
          })

          const exists = yield* fs.existsSafe(file)
          if (!exists) throw new Error(`File not found: ${file}`)

          const available = yield* lsp.hasClients(file)
          if (!available) throw new Error("No LSP server available for this file type.")

          yield* lsp.touchFile(file, "document")

          const uri = pathToFileURL(file).href
          const relPath = path.relative(Instance.worktree, file)

          if (args.operation === "documentSymbol") {
            const result: unknown[] = yield* lsp.documentSymbol(uri)
            return {
              title: `documentSymbol ${relPath}`,
              metadata: { result },
              output: result.length === 0 ? `No document symbols found` : JSON.stringify(result, null, 2),
            }
          }

          if (args.line === undefined || args.character === undefined) {
            throw new Error(`line and character are required for operation '${args.operation}'`)
          }

          const position = { file, line: args.line - 1, character: args.character - 1 }
          const detail = `${relPath}:${args.line}:${args.character}`
          const title = `${args.operation} ${detail}`

          const result: unknown[] = yield* (() => {
            switch (args.operation) {
              case "goToDefinition":
                return lsp.definition(position)
              case "findReferences":
                return lsp.references(position)
              case "hover":
                return lsp.hover(position)
              case "goToImplementation":
                return lsp.implementation(position)
              case "prepareCallHierarchy":
                return lsp.prepareCallHierarchy(position)
              case "incomingCalls":
                return lsp.incomingCalls(position)
              case "outgoingCalls":
                return lsp.outgoingCalls(position)
              default:
                throw new Error(`Unknown operation: ${args.operation}`)
            }
          })()

          return {
            title,
            metadata: { result },
            output: result.length === 0 ? `No results found for ${args.operation}` : JSON.stringify(result, null, 2),
          }
        }),
    }
  }),
)
