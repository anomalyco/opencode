import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertExternalDirectory } from "./external-directory"

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
  "restartServer",
] as const

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z.enum(operations).describe("The LSP operation to perform"),
    filePath: z
      .string()
      .optional()
      .describe("The absolute or relative path to the file (required for most operations)"),
    line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The line number (1-based, required for position-based operations)"),
    character: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The character offset (1-based, required for position-based operations)"),
    extension: z.string().optional().describe("File extension for restartServer operation (e.g., '.py', '.ts')"),
  }),
  execute: async (args, ctx) => {
    if (args.operation === "restartServer") {
      if (!args.extension) {
        throw new Error("extension is required for restartServer operation")
      }
      const ext = args.extension.startsWith(".") ? args.extension : `.${args.extension}`
      await ctx.ask({
        permission: "lsp",
        patterns: ["*"],
        always: ["*"],
        metadata: {},
      })
      const restarted = await LSP.restartByExtension(ext)
      const output =
        restarted.length === 0
          ? `No LSP servers found for extension ${ext}`
          : `Restarted LSP server(s): ${restarted.join(", ")}`
      return {
        title: `restartServer ${ext}`,
        metadata: { result: restarted },
        output,
      }
    }

    if (!args.filePath) {
      throw new Error("filePath is required for this operation")
    }
    if (args.line === undefined) {
      throw new Error("line is required for this operation")
    }
    if (args.character === undefined) {
      throw new Error("character is required for this operation")
    }

    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
    await assertExternalDirectory(ctx, file)

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const uri = pathToFileURL(file).href
    const position = {
      file,
      line: args.line - 1,
      character: args.character - 1,
    }

    const relPath = path.relative(Instance.worktree, file)
    const title = `${args.operation} ${relPath}:${args.line}:${args.character}`

    const exists = await Bun.file(file).exists()
    if (!exists) {
      throw new Error(`File not found: ${file}`)
    }

    const available = await LSP.hasClients(file)
    if (!available) {
      throw new Error("No LSP server available for this file type.")
    }

    await LSP.touchFile(file, true)

    const result: unknown[] = await (async () => {
      switch (args.operation) {
        case "goToDefinition":
          return LSP.definition(position)
        case "findReferences":
          return LSP.references(position)
        case "hover":
          return LSP.hover(position)
        case "documentSymbol":
          return LSP.documentSymbol(uri)
        case "workspaceSymbol":
          return LSP.workspaceSymbol("")
        case "goToImplementation":
          return LSP.implementation(position)
        case "prepareCallHierarchy":
          return LSP.prepareCallHierarchy(position)
        case "incomingCalls":
          return LSP.incomingCalls(position)
        case "outgoingCalls":
          return LSP.outgoingCalls(position)
        case "restartServer":
          throw new Error("Unreachable")
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
