export * as ExtensionSecurity from "./security.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import type { Extension } from "@opencode/schema/extension"

const SUSPICIOUS_PATTERNS = [
  {
    code: "SEC-CMD-FORMAT",
    pattern: /\b(format\s+[a-z]:|mkfs|rm\s+-rf\s+[\/\\])/i,
    message: "Destructive filesystem operation detected",
    severity: "critical" as const,
  },
  {
    code: "SEC-SECRET-TOKEN",
    pattern: /(?:\b(ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{20,})|-----BEGIN\s+(?:[A-Z]+\s+)?PRIVATE\s+KEY-----)/,
    message: "Hardcoded secret or private key pattern detected",
    severity: "error" as const,
  },
  {
    code: "SEC-DANGEROUS-EVAL",
    pattern: /\b(eval\s*\(|new\s+Function\s*\()/i,
    message: "Dynamic code execution or eval detected",
    severity: "error" as const,
  },
  {
    code: "SEC-COMMAND-EXEC",
    pattern: /\b(child_process|exec\s*\(|spawn\s*\(|execSync\s*\(|fork\s*\()/i,
    message: "Process execution or spawn invocation detected",
    severity: "warning" as const,
  },
  {
    code: "SEC-REMOTE-EXEC",
    pattern: /\b(curl|wget)\s+[^|]+\|\s*(ba|z)?sh/i,
    message: "Unpinned remote execution pipe detected",
    severity: "warning" as const,
  },
  {
    code: "SEC-ENV-EXFIL",
    pattern: /\bprocess\.env\b.*\b(fetch|axios|http\.request)\b/i,
    message: "Potential environment variable transmission detected",
    severity: "warning" as const,
  },
]

export function isPathSafe(relativePath: string): boolean {
  if (!relativePath || relativePath.length === 0) return false
  if (relativePath.includes("\0")) return false
  const normalized = path.normalize(relativePath)
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false
  return true
}

export function scanContent(content: string, filename?: string): Extension.SecurityFinding[] {
  const findings: Extension.SecurityFinding[] = []
  const lines = content.split("\n")

  lines.forEach((line, index) => {
    for (const rule of SUSPICIOUS_PATTERNS) {
      if (rule.pattern.test(line)) {
        findings.push({
          severity: rule.severity,
          code: rule.code,
          message: rule.message,
          file: filename,
          line: index + 1,
        })
      }
    }
  })

  return findings
}

export const scanDirectory = Effect.fn("ExtensionSecurity.scanDirectory")(function* (directory: string) {
  const fs = yield* FSUtil.Service
  const findings: Extension.SecurityFinding[] = []

  const files = yield* fs.scan("**/*", {
    cwd: directory,
    absolute: false,
    include: "file",
    dot: true,
    ignore: FSUtil.ignoreGlobs,
  }).pipe(Effect.orElseSucceed(() => []))

  let scannedCount = 0

  for (const rel of files) {
    if (!isPathSafe(rel)) {
      findings.push({
        severity: "critical",
        code: "SEC-TRAVERSAL",
        message: `Unsafe relative path or path traversal detected: ${rel}`,
        file: rel,
      })
      continue
    }

    scannedCount++
    const fullPath = path.join(directory, rel)
    const content = yield* fs.readFileStringSafe(fullPath).pipe(Effect.orElseSucceed(() => undefined))
    if (content) {
      findings.push(...scanContent(content, rel))
    }
  }

  const criticalCount = findings.filter((f) => f.severity === "critical").length
  const errorCount = findings.filter((f) => f.severity === "error").length
  const warningCount = findings.filter((f) => f.severity === "warning").length

  const riskLevel = criticalCount > 0 ? "critical" : errorCount > 0 ? "high" : warningCount > 0 ? "medium" : "low"
  const safe = criticalCount === 0 && errorCount === 0

  const report: Extension.SecurityReport = {
    safe,
    riskLevel,
    findings,
    scannedFiles: scannedCount,
    timestamp: Date.now(),
  }

  return report
})
