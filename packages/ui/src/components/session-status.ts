import type { SessionStatus } from "@opencode-ai/sdk/v2"

export function busy(status?: Pick<SessionStatus, "type">) {
  return status?.type === "busy" || status?.type === "retry" || status?.type === "suspending"
}
