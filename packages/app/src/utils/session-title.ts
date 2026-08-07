import type { SessionInfo } from "@opencode-ai/client/promise"
import { displayLabel } from "@opencode-ai/util/session-title-fallback"

const pattern = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function sessionLabel(session: Pick<SessionInfo, "title" | "parentID">) {
  return displayLabel(session)
}

export function sessionTitle(title?: string) {
  if (!title) return title
  const match = title.match(pattern)
  return match?.[1] ?? title
}
