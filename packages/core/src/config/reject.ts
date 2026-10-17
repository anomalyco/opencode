export * as ConfigReject from "./reject"

import { Result, SchemaIssue, SchemaParser } from "effect"
import { Info } from "@opencode/schema/config"

// The normalized `encoded` document is re-decoded against the canonical schema.
// This is the last line of defence: normalization decodes field by field, so a
// failure here means a field combination that only the whole-document decode
// can see. Failures surface as a `Rejected` entry, so the reason names the
// failing field instead of a generic message.
const decodeInfo = SchemaParser.decodeUnknownResult(Info, { errors: "all", onExcessProperty: "ignore" })

export function decodeInfoOrReason(value: unknown): Result.Result<Info, string> {
  const decoded = decodeInfo(value)
  if (Result.isSuccess(decoded)) return Result.succeed(decoded.success)
  return Result.fail(reason(decoded.failure))
}

function reason(issue: SchemaIssue.Issue): string {
  const path = issuePath(issue)
  return path.length === 0 ? "configuration is not valid" : `configuration is not valid: ${path.join(".")}`
}

// Recovers the failing field path from a decode issue. Union alternatives are not guessed, so a value
// wrapped in a union keeps the enclosing path instead of reporting an arbitrary branch. #50832 is
// localizing normalization diagnostics the same way and can share this once it lands.
function issuePath(issue: SchemaIssue.Issue): string[] {
  if (issue._tag === "Pointer") return [...issue.path.map((key) => String(key)), ...issuePath(issue.issue)]
  if (issue._tag === "Composite") return issuePath(issue.issues[0])
  if (issue._tag === "Encoding" || issue._tag === "Filter") return issuePath(issue.issue)
  return []
}
