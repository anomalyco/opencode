/** Redaction patterns (spec Part A §7.4, exact list/order). */
import type { LedgerRecord } from "./types"

export const REDACTIONS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{20,}/g, "[redacted]"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/g, "[redacted]"],
  [/AKIA[0-9A-Z]{16}/g, "[redacted]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted]"],
  [/(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]"],
  [/:[/][/][^/\s:@]+:[^@\s]+@/g, "://[redacted]@"],
]

export function redact(input: string): string {
  let out = input
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

export function redactRecordFields<T extends LedgerRecord>(rec: T): T {
  return {
    ...rec,
    text: redact(rec.text),
    rationale: rec.rationale ? redact(rec.rationale) : rec.rationale,
    process: rec.process
      ? {
          command: redact(rec.process.command),
          purpose: redact(rec.process.purpose),
          onResult: redact(rec.process.onResult),
        }
      : rec.process,
  }
}
