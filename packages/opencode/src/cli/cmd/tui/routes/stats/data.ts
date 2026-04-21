/**
 * Extracts `UsageRecord`s from the sync store (sessions + messages already
 * loaded in memory) and, when missing data is needed, fetches it lazily.
 */
import type { Message, Session } from "@opencode-ai/sdk/v2"
import type { UsageRecord } from "@tui/util/usage-stats"

export function recordsFromMessages(
  session: Pick<Session, "id" | "time">,
  messages: readonly Message[],
): UsageRecord[] {
  const records: UsageRecord[] = []
  let sessionStart = session.time.created
  let sessionEnd = session.time.updated
  for (const msg of messages) {
    if (msg.time?.created && msg.time.created < sessionStart) sessionStart = msg.time.created
    if (msg.role === "assistant" && msg.time.completed && msg.time.completed > sessionEnd) {
      sessionEnd = msg.time.completed
    }
  }
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const input = (msg.tokens?.input ?? 0) + (msg.tokens?.cache?.read ?? 0) + (msg.tokens?.cache?.write ?? 0)
    const output = (msg.tokens?.output ?? 0) + (msg.tokens?.reasoning ?? 0)
    if (input + output <= 0) continue
    records.push({
      timestamp: msg.time.created,
      model: `${msg.providerID}/${msg.modelID}`,
      input,
      output,
      sessionID: session.id,
      sessionStart,
      sessionEnd,
    })
  }
  return records
}

/** Compact display label for a model id like "anthropic/claude-opus-4-7". */
export function displayModel(fullId: string): string {
  const slash = fullId.lastIndexOf("/")
  const raw = slash >= 0 ? fullId.slice(slash + 1) : fullId
  const cleaned = raw.replace(/^claude-/, "").replace(/-\d{8}$/, "")
  return cleaned
}
