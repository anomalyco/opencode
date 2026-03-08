import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory } from "./external-directory"
import { Filesystem } from "../util/filesystem"

const operations = [
  "goToDefinition",
  "findReferences",
  "diagnostics",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

const positionOperations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

const fileOperations = ["diagnostics", "documentSymbol", "workspaceSymbol"] as const

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: z
    .object({
      operation: z.enum(operations).describe("The LSP operation to perform"),
      filePath: z.string().describe("The absolute or relative path to the file"),
      line: z.number().int().min(1).optional().describe("The line number (1-based, as shown in editors)"),
      character: z.number().int().min(1).optional().describe("The character offset (1-based, as shown in editors)"),
    })
    .superRefine((args, ctx) => {
      if ((positionOperations as readonly string[]).includes(args.operation)) {
        if (args.line === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["line"],
            message: `line is required for ${args.operation}`,
          })
        }
        if (args.character === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["character"],
            message: `character is required for ${args.operation}`,
          })
        }
      }
      if ((fileOperations as readonly string[]).includes(args.operation)) {
        if (args.line !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["line"],
            message: `line is not used for ${args.operation}`,
          })
        }
        if (args.character !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["character"],
            message: `character is not used for ${args.operation}`,
          })
        }
      }
    }),
  execute: async (args, ctx) => {
    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
    await assertExternalDirectory(ctx, file)

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const uri = pathToFileURL(file).href
    const position = args.line !== undefined && args.character !== undefined
      ? {
          file,
          line: args.line - 1,
          character: args.character - 1,
        }
      : undefined

    const relPath = path.relative(Instance.worktree, file)
    const title = position
      ? `${args.operation} ${relPath}:${position.line + 1}:${position.character + 1}`
      : `${args.operation} ${relPath}`

    const exists = await Filesystem.exists(file)
    if (!exists) {
      throw new Error(`File not found: ${file}`)
    }

    const available = await LSP.hasClients(file)
    if (!available) {
      throw new Error("No LSP server available for this file type.")
    }

    if (args.operation !== "workspaceSymbol") {
      await LSP.touchFile(file, true)
    }

    const result: unknown[] = await (async () => {
      switch (args.operation) {
        case "goToDefinition":
          return LSP.definition(position!)
        case "findReferences":
          return LSP.references(position!)
        case "diagnostics": {
          const diagnostics = await LSP.diagnostics()
          return diagnostics[Filesystem.normalizePath(file)] ?? []
        }
        case "hover":
          return LSP.hover(position!)
        case "documentSymbol":
          return LSP.documentSymbol(uri)
        case "workspaceSymbol":
          return LSP.workspaceSymbol("")
        case "goToImplementation":
          return LSP.implementation(position!)
        case "prepareCallHierarchy":
          return LSP.prepareCallHierarchy(position!)
        case "incomingCalls":
          return LSP.incomingCalls(position!)
        case "outgoingCalls":
          return LSP.outgoingCalls(position!)
      }
    })()

    const output = (() => {
      if (result.length === 0) return `No results found for ${args.operation}`
      return JSON.stringify(result, null, 2)
    })()

    return {
      title,
      metadata: { result },
      output,
    }
  },
})
