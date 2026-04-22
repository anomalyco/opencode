import z from "zod"
import { Tool } from "../shared/tool"
import path from "path"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { fileURLToPath, pathToFileURL } from "url"
import { assertExternalDirectory } from "../external-directory"
import { Filesystem } from "../../util/filesystem"
import { normalizeEditFollowupResult } from "../edit/runtime"
import { sanitizeDiscriminatedInput } from "../shared/shape"

const NonEmptyString = z.string().trim().min(1)

const DESCRIPTION = `Read-only interaction with Language Server Protocol (LSP) servers for code intelligence features.

This tool is read-only. It does not apply edits.
Any semantic/LSP-assisted edit flow must stay separate from this tool and route through the canonical edit-contract lane metadata instead.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

Operation-specific parameters:
- \`workspaceSymbol\` requires only \`query\`
- \`documentSymbol\` requires only \`filePath\`
- Positional operations (\`goToDefinition\`, \`findReferences\`, \`hover\`, \`goToImplementation\`, \`prepareCallHierarchy\`, \`incomingCalls\`, \`outgoingCalls\`) require:
  - \`filePath\`: The file to operate on
  - \`line\`: The line number (1-based, as shown in editors)
  - \`character\`: The character offset (1-based, as shown in editors)

Note: This tool is query-only. It does not apply semantic edits or workspace edits.
LSP servers must be configured for the file and workspace. If no matching server is available for the current file/workspace path, an error will be returned.`

export const lspOperations = [
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
const lspAllowed = {
  workspaceSymbol: ["query"],
  documentSymbol: ["filePath"],
  goToDefinition: ["filePath", "line", "character"],
  findReferences: ["filePath", "line", "character"],
  hover: ["filePath", "line", "character"],
  goToImplementation: ["filePath", "line", "character"],
  prepareCallHierarchy: ["filePath", "line", "character"],
  incomingCalls: ["filePath", "line", "character"],
  outgoingCalls: ["filePath", "line", "character"],
} as const
const lspInjectedDefaults = {
  line: (value: unknown) => value === 1,
  character: (value: unknown) => value === 1,
} satisfies Partial<Record<string, (value: unknown) => boolean>>

const kinds: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enum_member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type_parameter",
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function loc(value: unknown, fallback?: string) {
  const item = record(value)
  const spot = [item.targetSelectionRange, item.targetRange, item.selectionRange, item.range]
    .map((item) => record(item))
    .find((item) => item.start)
  const start = record(spot?.start)
  const line = typeof start.line === "number" ? start.line + 1 : undefined
  const character = typeof start.character === "number" ? start.character + 1 : undefined
  if (!line || !character) return

  const uri = typeof item.targetUri === "string" ? item.targetUri : typeof item.uri === "string" ? item.uri : undefined
  const file = (() => {
    if (uri) {
      try {
        return Filesystem.normalizePath(fileURLToPath(uri))
      } catch {
        return
      }
    }
    return fallback
  })()
  if (!file) return

  const rel = path.relative(Instance.worktree, file)
  return `${rel.startsWith("..") ? file : rel}:${line}:${character}`
}

function text(value: unknown): string[] {
  if (typeof value === "string") {
    const item = value.trim()
    if (!item) return []
    return [item]
  }

  if (Array.isArray(value)) return value.flatMap(text)

  const item = record(value)
  if (typeof item.value === "string") {
    const value = item.value.trim()
    if (!value) return []
    return [value]
  }

  return []
}

function symbolLine(value: unknown, fallback?: string) {
  const item = record(value)
  const name = typeof item.name === "string" ? item.name : "anonymous"
  const detail = typeof item.detail === "string" && item.detail.trim() ? ` — ${item.detail.trim()}` : ""
  const kind = typeof item.kind === "number" ? ` (${kinds[item.kind] ?? `kind ${item.kind}`})` : ""
  const where = loc(item.location ?? item, fallback)
  if (!where) return `${name}${kind}${detail}`
  return `${name}${kind}${detail} — ${where}`
}

function callLine(value: unknown) {
  const item = record(value)
  return symbolLine(item.from ?? item.to)
}

function format(operation: (typeof lspOperations)[number], file: string | undefined, result: unknown[]) {
  if (result.length === 0) return `No results found for ${operation}`

  if (operation === "hover") {
    const output = result
      .map((item) => {
        const here = loc(item, file)
        const body = text(record(item).contents).join("\n\n")
        if (!body) return
        if (!here) return body
        return `${here}\n${body}`
      })
      .filter(Boolean)
      .join("\n\n---\n\n")

    if (output) return output
    return JSON.stringify(result, null, 2)
  }

  if (operation === "documentSymbol" || operation === "workspaceSymbol" || operation === "prepareCallHierarchy") {
    const lines = result.map((item) => symbolLine(item, file)).filter(Boolean)
    if (!lines.length) return JSON.stringify(result, null, 2)
    return lines.map((line) => `- ${line}`).join("\n")
  }

  if (operation === "incomingCalls" || operation === "outgoingCalls") {
    const lines = result.map(callLine).filter(Boolean)
    if (!lines.length) return JSON.stringify(result, null, 2)
    return lines.map((line) => `- ${line}`).join("\n")
  }

  const lines = result.map((item) => loc(item, file)).filter(Boolean)
  if (!lines.length) return JSON.stringify(result, null, 2)
  return lines.map((line) => `- ${line}`).join("\n")
}

function warnings(lines: string[]) {
  if (!lines.length) return
  return lines.map((line) => `LSP notice: ${line}`).join("\n")
}

const positionalOperations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

export const LspWorkspaceSymbolParametersSchema = z
  .object({
    operation: z.literal("workspaceSymbol").describe("The LSP operation to perform"),
    filePath: z.never().optional(),
    line: z.never().optional(),
    character: z.never().optional(),
    query: NonEmptyString.describe("Workspace symbol query for workspaceSymbol operations"),
  })
  .strict()

export const LspDocumentSymbolParametersSchema = z
  .object({
    operation: z.literal("documentSymbol").describe("The LSP operation to perform"),
    filePath: NonEmptyString.describe(
      "The absolute or relative path to the file when the operation targets a specific file.",
    ),
    line: z.never().optional(),
    character: z.never().optional(),
    query: z.never().optional(),
  })
  .strict()

export const LspPositionalParametersSchema = z
  .object({
    operation: z.enum(positionalOperations).describe("The LSP operation to perform"),
    filePath: NonEmptyString.describe(
      "The absolute or relative path to the file when the operation targets a specific position.",
    ),
    line: z
      .number()
      .int()
      .min(1)
      .describe("The line number (1-based, as shown in editors) when the operation targets a specific position."),
    character: z
      .number()
      .int()
      .min(1)
      .describe("The character offset (1-based, as shown in editors) when the operation targets a specific position."),
    query: z.never().optional(),
  })
  .strict()

const variants = positionalOperations.map((operation) =>
  z
    .object({
      operation: z.literal(operation).describe("The LSP operation to perform"),
      filePath: NonEmptyString.describe(
        "The absolute or relative path to the file when the operation targets a specific position.",
      ),
      line: z
        .number()
        .int()
        .min(1)
        .describe("The line number (1-based, as shown in editors) when the operation targets a specific position."),
      character: z
        .number()
        .int()
        .min(1)
        .describe(
          "The character offset (1-based, as shown in editors) when the operation targets a specific position.",
        ),
      query: z.never().optional(),
    })
    .strict(),
)

export const LspParametersSchema = z.preprocess(
  (input) =>
    sanitizeDiscriminatedInput(input, {
      discriminant: "operation",
      allowed: lspAllowed,
      strip: lspInjectedDefaults,
    }),
  z.discriminatedUnion("operation", [
    LspWorkspaceSymbolParametersSchema,
    LspDocumentSymbolParametersSchema,
    ...variants,
  ]),
)

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: LspParametersSchema,
  execute: async (args, ctx) => {
    const file = args.filePath
      ? path.isAbsolute(args.filePath)
        ? args.filePath
        : path.join(Instance.directory, args.filePath)
      : undefined
    if (file) await assertExternalDirectory(ctx, file)

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const uri = file ? pathToFileURL(file).href : undefined
    const position = {
      file,
      line: (args.line ?? 1) - 1,
      character: (args.character ?? 1) - 1,
    }

    const relPath = file ? path.relative(Instance.worktree, file) : undefined
    const title =
      args.operation === "workspaceSymbol"
        ? `${args.operation} ${args.query}`
        : args.operation === "documentSymbol"
          ? `${args.operation} ${relPath}`
          : `${args.operation} ${relPath}:${args.line}:${args.character}`

    if (file) {
      const exists = await Filesystem.exists(file)
      if (!exists) throw new Error(`File not found: ${file}`)
    }

    const available = file ? await LSP.hasClients(file) : true
    if (!available) {
      ctx.metadata({
        metadata: {
          runtime: {
            followupResult: normalizeEditFollowupResult({
              evaluation: {
                languageServerAvailable: false,
              },
            }),
          },
        },
      })
      throw new Error("No LSP server is available for this file/workspace path.")
    }

    const touch = file ? await LSP.touchFile(file, true) : undefined
    const query = await (async () => {
      try {
        switch (args.operation) {
          case "goToDefinition":
          case "findReferences":
          case "hover":
          case "goToImplementation":
          case "prepareCallHierarchy":
          case "incomingCalls":
          case "outgoingCalls":
            return await LSP.query({
              operation: args.operation,
              file: file!,
              line: position.line,
              character: position.character,
            })
          case "documentSymbol":
            return await LSP.query({
              operation: args.operation,
              uri: uri!,
            })
          case "workspaceSymbol":
            if (!args.query?.trim()) {
              throw new Error("workspaceSymbol requires a non-empty query")
            }
            return await LSP.query({
              operation: args.operation,
              query: args.query,
            })
        }
      } finally {
        if (file) await LSP.closeFile(file).catch(() => undefined)
      }
    })()

    const result = query.result
    const notes = warnings([...(touch ? LSP.touchWarnings(touch) : []), ...LSP.queryWarnings(query)])

    return {
      title,
      metadata: {
        result,
        summary: {
          operation: args.operation,
          count: result.length,
          query: args.query,
        },
        lsp: {
          touch,
          issues: query.issues,
        },
      },
      output: [notes, format(args.operation, file, result)].filter(Boolean).join("\n\n"),
    }
  },
})
