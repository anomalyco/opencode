import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL, fileURLToPath } from "url"

const DEFAULT_MAX_REFERENCES = 50
const DEFAULT_MAX_SYMBOLS = 50
const DEFAULT_MAX_DIAGNOSTICS = 50

const SymbolKindNames: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
}

function resolvePath(file: string): string {
  return path.isAbsolute(file) ? file : path.join(Instance.directory, file)
}

function formatLocation(loc: any): string {
  if (!loc) return ""
  const uri = loc.targetUri || loc.uri
  if (!uri) return ""
  const file = uri.startsWith("file://") ? fileURLToPath(uri) : uri
  const range = loc.targetRange || loc.range
  if (!range) return path.relative(Instance.directory, file)
  const line = range.start.line + 1
  const col = range.start.character + 1
  return `${path.relative(Instance.directory, file)}:${line}:${col}`
}

function formatSymbol(symbol: any): string {
  const kind = SymbolKindNames[symbol.kind] || `Kind(${symbol.kind})`
  if (symbol.location) {
    const loc = formatLocation(symbol.location)
    return `${symbol.name} [${kind}] ${loc}`
  }
  if (symbol.range) {
    const line = symbol.range.start.line + 1
    return `${symbol.name} [${kind}] line ${line}`
  }
  return `${symbol.name} [${kind}]`
}

function formatDocumentSymbol(symbol: any, indent = 0): string {
  const prefix = "  ".repeat(indent)
  const kind = SymbolKindNames[symbol.kind] || `Kind(${symbol.kind})`
  const line = symbol.range?.start?.line !== undefined ? symbol.range.start.line + 1 : "?"
  const detail = symbol.detail ? ` - ${symbol.detail}` : ""
  let result = `${prefix}${symbol.name} [${kind}] line ${line}${detail}`
  if (symbol.children?.length) {
    for (const child of symbol.children) {
      result += "\n" + formatDocumentSymbol(child, indent + 1)
    }
  }
  return result
}

function formatHoverResult(result: any): string {
  if (!result) return "No hover information"
  const contents = result.contents
  if (!contents) return "No hover information"
  if (typeof contents === "string") return contents
  if (contents.value) return contents.value
  if (Array.isArray(contents)) {
    return contents
      .map((c: any) => {
        if (typeof c === "string") return c
        return c.value || ""
      })
      .filter(Boolean)
      .join("\n\n")
  }
  return JSON.stringify(contents)
}

function formatDiagnostic(diag: any): string {
  const severityMap: Record<number, string> = {
    1: "ERROR",
    2: "WARNING",
    3: "INFO",
    4: "HINT",
  }
  const severity = severityMap[diag.severity || 1]
  const line = diag.range.start.line + 1
  const col = diag.range.start.character + 1
  const source = diag.source ? `[${diag.source}] ` : ""
  return `${severity} [${line}:${col}] ${source}${diag.message}`
}

function filterDiagnosticsBySeverity(diagnostics: any[], severity?: string): any[] {
  if (!severity || severity === "all") return diagnostics
  const severityMap: Record<string, number> = {
    error: 1,
    warning: 2,
    information: 3,
    hint: 4,
  }
  const level = severityMap[severity]
  if (!level) return diagnostics
  return diagnostics.filter((d) => d.severity === level)
}

function formatPrepareRenameResult(result: any): string {
  if (!result) return "Cannot rename at this position"
  if (result.defaultBehavior) return "Rename available (default behavior)"
  if (result.range) {
    const line = result.range.start.line + 1
    const col = result.range.start.character + 1
    const placeholder = result.placeholder || ""
    return `Rename available at ${line}:${col}${placeholder ? ` (current: "${placeholder}")` : ""}`
  }
  if (result.start) {
    const line = result.start.line + 1
    return `Rename available at line ${line}`
  }
  return "Rename available"
}

interface WorkspaceEdit {
  changes?: Record<string, any[]>
  documentChanges?: any[]
}

interface ApplyResult {
  filesChanged: number
  totalEdits: number
  files: string[]
}

async function applyWorkspaceEdit(edit: WorkspaceEdit | null): Promise<ApplyResult> {
  if (!edit) return { filesChanged: 0, totalEdits: 0, files: [] }

  const result: ApplyResult = { filesChanged: 0, totalEdits: 0, files: [] }

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const file = uri.startsWith("file://") ? fileURLToPath(uri) : uri
      result.files.push(path.relative(Instance.directory, file))
      result.totalEdits += edits.length

      const content = await Bun.file(file).text()
      const lines = content.split("\n")

      const sorted = [...edits].sort((a, b) => {
        if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line
        return b.range.start.character - a.range.start.character
      })

      for (const e of sorted) {
        const startLine = e.range.start.line
        const endLine = e.range.end.line
        const startChar = e.range.start.character
        const endChar = e.range.end.character

        if (startLine === endLine) {
          const line = lines[startLine] || ""
          lines[startLine] = line.slice(0, startChar) + e.newText + line.slice(endChar)
        } else {
          const firstLine = lines[startLine] || ""
          const lastLine = lines[endLine] || ""
          const newContent = firstLine.slice(0, startChar) + e.newText + lastLine.slice(endChar)
          lines.splice(startLine, endLine - startLine + 1, newContent)
        }
      }

      await Bun.write(file, lines.join("\n"))
      result.filesChanged++
    }
  }

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if (change.textDocument && change.edits) {
        const uri = change.textDocument.uri
        const file = uri.startsWith("file://") ? fileURLToPath(uri) : uri
        result.files.push(path.relative(Instance.directory, file))
        result.totalEdits += change.edits.length

        const content = await Bun.file(file).text()
        const lines = content.split("\n")

        const sorted = [...change.edits].sort((a: any, b: any) => {
          if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line
          return b.range.start.character - a.range.start.character
        })

        for (const e of sorted) {
          const startLine = e.range.start.line
          const endLine = e.range.end.line
          const startChar = e.range.start.character
          const endChar = e.range.end.character

          if (startLine === endLine) {
            const line = lines[startLine] || ""
            lines[startLine] = line.slice(0, startChar) + e.newText + line.slice(endChar)
          } else {
            const firstLine = lines[startLine] || ""
            const lastLine = lines[endLine] || ""
            const newContent = firstLine.slice(0, startChar) + e.newText + lastLine.slice(endChar)
            lines.splice(startLine, endLine - startLine + 1, newContent)
          }
        }

        await Bun.write(file, lines.join("\n"))
        result.filesChanged++
      }
    }
  }

  return result
}

function formatApplyResult(result: ApplyResult): string {
  if (result.filesChanged === 0) return "No changes to apply"
  return `Applied ${result.totalEdits} edit(s) across ${result.filesChanged} file(s):\n${result.files.map((f) => `  - ${f}`).join("\n")}`
}

interface CodeAction {
  title: string
  kind?: string
  disabled?: { reason: string }
  edit?: WorkspaceEdit
  command?: { title: string; command: string }
}

function formatCodeActions(actions: CodeAction[] | null): string {
  if (!actions || actions.length === 0) return "No code actions available"
  const lines: string[] = []
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    const kind = action.kind ? ` [${action.kind}]` : ""
    const disabled = action.disabled ? ` (disabled: ${action.disabled.reason})` : ""
    lines.push(`${i + 1}. ${action.title}${kind}${disabled}`)
    if (action.edit || action.command) {
      const json = JSON.stringify(action)
      lines.push(`   JSON: ${json}`)
    }
  }
  return lines.join("\n")
}

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum([
        "hover",
        "definition",
        "references",
        "documentSymbols",
        "workspaceSymbols",
        "diagnostics",
        "prepareRename",
        "rename",
        "codeActions",
        "codeActionResolve",
      ])
      .describe("The LSP action to execute"),
    filePath: z.string().describe("Absolute path to the file"),
    line: z.number().min(1).optional().describe("Line number (1-based)"),
    character: z.number().min(0).optional().describe("Character position (0-based)"),
    includeDeclaration: z.boolean().optional().describe("Include the declaration in references"),
    newName: z.string().optional().describe("New name for rename"),
    query: z.string().optional().describe("Symbol name to search for"),
    limit: z.number().optional().describe("Max results for workspace symbols"),
    severity: z
      .enum(["error", "warning", "information", "hint", "all"])
      .optional()
      .describe("Filter diagnostics by severity"),
    startLine: z.number().min(1).optional().describe("Start line for code action range (1-based)"),
    startCharacter: z.number().min(0).optional().describe("Start character for code action range (0-based)"),
    endLine: z.number().min(1).optional().describe("End line for code action range (1-based)"),
    endCharacter: z.number().min(0).optional().describe("End character for code action range (0-based)"),
    kind: z
      .enum([
        "quickfix",
        "refactor",
        "refactor.extract",
        "refactor.inline",
        "refactor.rewrite",
        "source",
        "source.organizeImports",
        "source.fixAll",
      ])
      .optional()
      .describe("Filter code actions by kind"),
    codeAction: z.string().optional().describe("Code action JSON from codeActions result"),
  }),
  async execute(args) {
    const file = resolvePath(args.filePath)
    const action = args.action

    await LSP.touchFile(file, true)

    const makeResult = (title: string, output: string, data?: unknown) => ({
      title,
      metadata: { data },
      output,
    })

    switch (action) {
      case "hover": {
        if (args.line === undefined || args.character === undefined) {
          throw new Error("line and character are required for hover")
        }
        const result = await LSP.hover({ file, line: args.line - 1, character: args.character })
        const output = formatHoverResult(result?.[0])
        return makeResult(
          `hover ${path.relative(Instance.directory, file)}:${args.line}:${args.character}`,
          output,
          result,
        )
      }

      case "definition": {
        if (args.line === undefined || args.character === undefined) {
          throw new Error("line and character are required for definition")
        }
        const result = await LSP.definition({ file, line: args.line - 1, character: args.character })
        if (!result) {
          return makeResult(
            `definition ${path.relative(Instance.directory, file)}:${args.line}:${args.character}`,
            "No definition found",
          )
        }
        const locations = Array.isArray(result) ? result : [result]
        const output = locations.length === 0 ? "No definition found" : locations.map(formatLocation).join("\n")
        return makeResult(
          `definition ${path.relative(Instance.directory, file)}:${args.line}:${args.character}`,
          output,
          result,
        )
      }

      case "references": {
        if (args.line === undefined || args.character === undefined) {
          throw new Error("line and character are required for references")
        }
        const result = await LSP.references({
          file,
          line: args.line - 1,
          character: args.character,
          includeDeclaration: args.includeDeclaration,
        })
        if (!result || (Array.isArray(result) && result.length === 0)) {
          return makeResult(
            `references ${path.relative(Instance.directory, file)}:${args.line}:${args.character}`,
            "No references found",
          )
        }
        const refs = Array.isArray(result) ? result : [result]
        const total = refs.length
        const truncated = total > DEFAULT_MAX_REFERENCES
        const limited = truncated ? refs.slice(0, DEFAULT_MAX_REFERENCES) : refs
        const lines = limited.map(formatLocation)
        if (truncated) {
          lines.unshift(`Found ${total} references (showing first ${DEFAULT_MAX_REFERENCES}):`)
        }
        return makeResult(
          `references ${path.relative(Instance.directory, file)}:${args.line}:${args.character}`,
          lines.join("\n"),
          { total, results: limited },
        )
      }

      case "documentSymbols": {
        const uri = pathToFileURL(file).href
        const result = await LSP.documentSymbol(uri)
        if (!result || result.length === 0) {
          return makeResult(`documentSymbols ${path.relative(Instance.directory, file)}`, "No symbols found")
        }
        const total = result.length
        const truncated = total > DEFAULT_MAX_SYMBOLS
        const limited = truncated ? result.slice(0, DEFAULT_MAX_SYMBOLS) : result
        const lines: string[] = []
        if (truncated) {
          lines.push(`Found ${total} symbols (showing first ${DEFAULT_MAX_SYMBOLS}):`)
        }
        for (const sym of limited) {
          if ("range" in sym) {
            lines.push(formatDocumentSymbol(sym))
          } else {
            lines.push(formatSymbol(sym))
          }
        }
        return makeResult(`documentSymbols ${path.relative(Instance.directory, file)}`, lines.join("\n"), {
          total,
          results: limited,
        })
      }

      case "workspaceSymbols": {
        if (!args.query) {
          throw new Error("query is required for workspaceSymbols")
        }
        const result = await LSP.workspaceSymbol(args.query)
        if (!result || result.length === 0) {
          return makeResult(`workspaceSymbols "${args.query}"`, "No symbols found")
        }
        const total = result.length
        const limit = Math.min(args.limit ?? DEFAULT_MAX_SYMBOLS, DEFAULT_MAX_SYMBOLS)
        const truncated = total > limit
        const limited = result.slice(0, limit)
        const lines = limited.map(formatSymbol)
        if (truncated) {
          lines.unshift(`Found ${total} symbols (showing first ${limit}):`)
        }
        return makeResult(`workspaceSymbols "${args.query}"`, lines.join("\n"), { total, results: limited })
      }

      case "diagnostics": {
        const result = await LSP.fileDiagnostics(file)
        const filtered = filterDiagnosticsBySeverity(result, args.severity)
        if (filtered.length === 0) {
          return makeResult(`diagnostics ${path.relative(Instance.directory, file)}`, "No diagnostics found")
        }
        const total = filtered.length
        const truncated = total > DEFAULT_MAX_DIAGNOSTICS
        const limited = truncated ? filtered.slice(0, DEFAULT_MAX_DIAGNOSTICS) : filtered
        const lines = limited.map(formatDiagnostic)
        if (truncated) {
          lines.unshift(`Found ${total} diagnostics (showing first ${DEFAULT_MAX_DIAGNOSTICS}):`)
        }
        return makeResult(`diagnostics ${path.relative(Instance.directory, file)}`, lines.join("\n"), {
          total,
          results: limited,
        })
      }

      case "prepareRename": {
        if (args.line === undefined || args.character === undefined) {
          throw new Error("line and character are required for prepareRename")
        }
        const result = await LSP.prepareRename({ file, line: args.line - 1, character: args.character })
        const output = formatPrepareRenameResult(result)
        return makeResult(
          `prepareRename ${path.relative(Instance.directory, file)}:${args.line}:${args.character}`,
          output,
          result,
        )
      }

      case "rename": {
        if (args.line === undefined || args.character === undefined) {
          throw new Error("line and character are required for rename")
        }
        if (!args.newName) {
          throw new Error("newName is required for rename")
        }
        const edit = await LSP.rename({
          file,
          line: args.line - 1,
          character: args.character,
          newName: args.newName,
        })
        const result = await applyWorkspaceEdit(edit as WorkspaceEdit | null)
        const output = formatApplyResult(result)
        return makeResult(
          `rename ${path.relative(Instance.directory, file)}:${args.line}:${args.character} -> "${args.newName}"`,
          output,
          result,
        )
      }

      case "codeActions": {
        if (
          args.startLine === undefined ||
          args.startCharacter === undefined ||
          args.endLine === undefined ||
          args.endCharacter === undefined
        ) {
          throw new Error("startLine, startCharacter, endLine, and endCharacter are required for codeActions")
        }
        const only = args.kind ? [args.kind] : undefined
        const result = await LSP.codeAction({
          file,
          startLine: args.startLine - 1,
          startCharacter: args.startCharacter,
          endLine: args.endLine - 1,
          endCharacter: args.endCharacter,
          only,
        })
        const output = formatCodeActions(result as CodeAction[] | null)
        return makeResult(
          `codeActions ${path.relative(Instance.directory, file)}:${args.startLine}-${args.endLine}`,
          output,
          result,
        )
      }

      case "codeActionResolve": {
        if (!args.codeAction) {
          throw new Error("codeAction JSON is required for codeActionResolve")
        }
        const codeAction = JSON.parse(args.codeAction) as CodeAction
        const resolved = (await LSP.codeActionResolve({ file, codeAction })) as CodeAction | null
        if (!resolved) {
          return makeResult("codeActionResolve", "Failed to resolve code action")
        }
        const lines: string[] = []
        lines.push(`Action: ${resolved.title}`)
        if (resolved.kind) lines.push(`Kind: ${resolved.kind}`)
        if (resolved.edit) {
          const result = await applyWorkspaceEdit(resolved.edit)
          lines.push(formatApplyResult(result))
        } else {
          lines.push("No edit to apply")
        }
        if (resolved.command) {
          lines.push(`Command: ${resolved.command.title} (${resolved.command.command}) - not executed`)
        }
        return makeResult(`codeActionResolve "${codeAction.title}"`, lines.join("\n"), resolved)
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  },
})
