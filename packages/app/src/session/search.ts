import type { SessionID } from "@opencode/schema/session-id"
export function looksLikeSessionID(value: string): value is SessionID {
  return value.length > 20 && value.startsWith("ses_")
}
