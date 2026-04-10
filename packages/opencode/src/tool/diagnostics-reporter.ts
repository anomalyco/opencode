import { LSP } from "../lsp"
import { LSPClient } from "../lsp/client"

const MAX_DIAGNOSTICS_PER_FILE = 20

export interface DiagnosticResult {
  output: string
  wasTruncated: boolean
}

export function formatDiagnostics(filePath: string, issues: LSPClient.Diagnostic[]): DiagnosticResult {
  const errors = issues.filter((item) => item.severity === 1)
  if (errors.length === 0) {
    return { output: "", wasTruncated: false }
  }

  const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
  const suffix =
    errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""

  const output = `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`

  return {
    output,
    wasTruncated: errors.length > MAX_DIAGNOSTICS_PER_FILE,
  }
}

export function formatDiagnosticsForOtherFile(filePath: string, issues: LSPClient.Diagnostic[]): DiagnosticResult {
  const errors = issues.filter((item) => item.severity === 1)
  if (errors.length === 0) {
    return { output: "", wasTruncated: false }
  }

  const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
  const suffix =
    errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""

  const output = `\n\nLSP errors detected in other files:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`

  return {
    output,
    wasTruncated: errors.length > MAX_DIAGNOSTICS_PER_FILE,
  }
}

export interface ProjectDiagnosticsResult {
  output: string
  currentFileOutput: string
  otherFilesCount: number
}

export function formatProjectDiagnostics(
  currentFile: string,
  diagnostics: Record<string, LSPClient.Diagnostic[]>,
  maxOtherFiles = 5,
): ProjectDiagnosticsResult {
  let currentFileOutput = ""
  let otherFilesOutput = ""
  let otherFilesCount = 0

  for (const [file, issues] of Object.entries(diagnostics)) {
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length === 0) continue

    const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    const suffix =
      errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""

    if (file === currentFile) {
      currentFileOutput = `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    } else if (otherFilesCount < maxOtherFiles) {
      otherFilesCount++
      otherFilesOutput += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }
  }

  return {
    output: currentFileOutput + otherFilesOutput,
    currentFileOutput,
    otherFilesCount,
  }
}
