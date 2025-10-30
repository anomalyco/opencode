import { LSPClient } from "../lsp/client"
import type { Diagnostic } from "vscode-languageserver-types"

/**
 * Type guard to check if diagnostics are in the new multi-server format
 */
export function isMultiServerFormat(
  diagnostics: Diagnostic[] | Array<{ diagnostic: Diagnostic; serverID: string }>,
): diagnostics is Array<{ diagnostic: Diagnostic; serverID: string }> {
  return diagnostics.length > 0 && "diagnostic" in diagnostics[0]
}

/**
 * Sanitize server ID for safe display in UI
 */
export function sanitizeServerID(serverID: string): string {
  if (typeof serverID !== "string") return "Unknown"

  let result = serverID

  // Handle special case: single tag like <typescript> -> typescript
  const singleTagMatch = result.match(/^<(\w+)>$/)
  if (singleTagMatch) {
    result = singleTagMatch[1]
  } else {
    // Remove HTML tags completely for other cases
    result = result.replace(/<[^>]*>/g, "")
  }

  return result
    .replace(/javascript:/gi, "") // Remove javascript protocol
    .replace(/data:/gi, "") // Remove data protocol
    .replace(/vbscript:/gi, "") // Remove vbscript protocol
    .replace(/on\w+=/gi, "") // Remove event handlers
    .trim()
    .substring(0, 100) // Limit length
}

/**
 * Group diagnostics by server ID for efficient processing
 * Optimized for large datasets using Map and batch operations
 */
export function groupDiagnosticsByServer(
  diagnostics: Array<{ diagnostic: Diagnostic; serverID: string }>,
): Record<string, Diagnostic[]> {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return {}
  }

  const grouped = new Map<string, Diagnostic[]>()

  // Batch process for better performance
  for (const item of diagnostics) {
    if (!validateDiagnosticItem(item)) continue

    const serverID = sanitizeServerID(item.serverID || "Unknown")
    const existing = grouped.get(serverID)

    if (existing) {
      existing.push(item.diagnostic)
    } else {
      grouped.set(serverID, [item.diagnostic])
    }
  }

  return Object.fromEntries(grouped)
}

/**
 * Sanitize diagnostic message for safe display
 */
export function sanitizeDiagnosticMessage(message: string): string {
  if (typeof message !== "string") return ""

  return message
    .replace(/[<>]/g, "") // Remove HTML tags
    .replace(/javascript:/gi, "") // Remove javascript protocol
    .replace(/data:/gi, "") // Remove data protocol
    .replace(/vbscript:/gi, "") // Remove vbscript protocol
    .replace(/on\w+=/gi, "") // Remove event handlers
    .trim()
    .substring(0, 1000) // Limit length
}

/**
 * Format a single diagnostic with server information
 */
export function formatDiagnosticWithServer(diagnostic: Diagnostic, serverID: string): string {
  if (!validateDiagnostic(diagnostic)) {
    return "ERROR [Invalid diagnostic]"
  }

  const severityMap: Record<number, string> = {
    1: "ERROR",
    2: "WARN",
    3: "INFO",
    4: "HINT",
  }

  const severity = severityMap[diagnostic.severity || 1]
  const line = Math.max(0, diagnostic.range.start.line + 1)
  const col = Math.max(0, diagnostic.range.start.character + 1)
  const sanitizedMessage = sanitizeDiagnosticMessage(diagnostic.message)

  return `${severity} [${line}:${col}] ${sanitizedMessage}`
}

/**
 * Format diagnostics with server grouping and separators
 */
export function formatDiagnosticsWithServers(diagnostics: Array<{ diagnostic: Diagnostic; serverID: string }>): string {
  if (!Array.isArray(diagnostics)) return ""

  const validDiagnostics = diagnostics.filter(validateDiagnosticItem)
  if (validDiagnostics.length === 0) return ""

  const grouped = groupDiagnosticsByServer(validDiagnostics)
  const serverNames = Object.keys(grouped)

  if (serverNames.length === 1) {
    // Only one server, no need for separators
    return grouped[serverNames[0]].map((d) => formatDiagnosticWithServer(d, serverNames[0])).join("\n")
  }

  // Multiple servers, add separators
  const result: string[] = []
  for (const [serverID, serverDiagnostics] of Object.entries(grouped)) {
    if (result.length > 0) {
      result.push("") // Add empty line for spacing
    }
    result.push(`--- ${sanitizeServerID(serverID).toUpperCase()} ---`)
    result.push(...serverDiagnostics.map((d) => formatDiagnosticWithServer(d, serverID)))
  }
  return result.join("\n")
}

/**
 * Filter diagnostics by severity level
 * Optimized with early validation
 */
export function filterDiagnosticsBySeverity(
  diagnostics: Array<{ diagnostic: Diagnostic; serverID: string }>,
  severity: number,
): Array<{ diagnostic: Diagnostic; serverID: string }> {
  if (!Array.isArray(diagnostics) || typeof severity !== "number") {
    return []
  }

  return diagnostics.filter((item) => validateDiagnosticItem(item) && item.diagnostic.severity === severity)
}

/**
 * Validate diagnostic object structure
 */
export function validateDiagnostic(diagnostic: any): diagnostic is Diagnostic {
  return !!(
    diagnostic != null &&
    typeof diagnostic === "object" &&
    typeof diagnostic.message === "string" &&
    diagnostic.range &&
    typeof diagnostic.range.start === "object" &&
    typeof diagnostic.range.start.line === "number" &&
    typeof diagnostic.range.start.character === "number"
  )
}

/**
 * Get error diagnostics (severity 1) from multi-server format
 */
export function getErrorDiagnostics(
  diagnostics: Array<{ diagnostic: Diagnostic; serverID: string }>,
): Array<{ diagnostic: Diagnostic; serverID: string }> {
  return filterDiagnosticsBySeverity(diagnostics, 1)
}

/**
 * Validate multi-server diagnostic item structure
 */
export function validateDiagnosticItem(item: any): item is { diagnostic: Diagnostic; serverID: string } {
  return (
    item != null && typeof item === "object" && validateDiagnostic(item.diagnostic) && typeof item.serverID === "string"
  )
}
