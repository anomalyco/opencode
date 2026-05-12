/**
 * SafetyValidator — Pre-execution shell safety validator
 * 
 * Checks shell/bash commands against known dangerous patterns before execution.
 * Integrated directly into tool/registry.ts execute flow (no plugin hook needed).
 */

export interface SafetyResult {
  allowed: boolean
  level: "BLOCK" | "WARN" | "LOG"
  description: string
  suggestion?: string
}

const DANGER_RULES: Array<{
  pattern: RegExp
  level: "BLOCK" | "WARN" | "LOG"
  description: string
  suggestion?: string
}> = [
  { pattern: /\brm\s+-rf\b/, level: "BLOCK", description: "Recursive force delete", suggestion: "Use rm -ri for interactive confirmation" },
  { pattern: /\bdd\s+if=/, level: "BLOCK", description: "Raw disk write", suggestion: "Verify target device" },
  { pattern: /\bmkfs\./, level: "BLOCK", description: "Filesystem format", suggestion: "Double-check device name" },
  { pattern: /:\s*\(\s*\)\s*\{/, level: "BLOCK", description: "Shell fork bomb pattern" },
  { pattern: /\/dev\/null.*>.*\/dev\/sd/, level: "BLOCK", description: "Raw disk device write" },
  { pattern: /\bsudo\b/, level: "WARN", description: "Elevated privileges", suggestion: "Confirm sudo is needed" },
  { pattern: /\bchmod\s+777\b/, level: "WARN", description: "World-writable permissions", suggestion: "Use chmod 755 or stricter" },
  { pattern: /\bchmod\s+-R\b/, level: "WARN", description: "Recursive permission change" },
  { pattern: /\bgit\s+push\s+--force\b/, level: "WARN", description: "Force push" },
  { pattern: /\bgit\s+reset\s+--hard\b/, level: "WARN", description: "Hard reset" },
  { pattern: /\bdocker\s+rm\s+-f\b/, level: "WARN", description: "Force remove container" },
  { pattern: /\bnpm\s+(unpublish|deprecate)\b/, level: "WARN", description: "Registry mutation" },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, level: "LOG", description: "Pipe to shell" },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, level: "LOG", description: "Pipe to shell" },
]

export function safetyCheck(command: string): SafetyResult | null {
  for (const rule of DANGER_RULES) {
    if (rule.pattern.test(command)) {
      return {
        allowed: rule.level !== "BLOCK",
        level: rule.level,
        description: rule.description,
        suggestion: rule.suggestion,
      }
    }
  }
  return null
}
