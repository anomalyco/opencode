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
    const assistant = msg
    const input = assistant.tokens?.input ?? 0
    const output = assistant.tokens?.output ?? 0
    const reasoning = assistant.tokens?.reasoning ?? 0
    const cacheRead = assistant.tokens?.cache?.read ?? 0
    const cacheWrite = assistant.tokens?.cache?.write ?? 0
    const totalInput = input + cacheRead + cacheWrite
    const totalOutput = output + reasoning
    if (totalInput + totalOutput <= 0) continue
    records.push({
      timestamp: assistant.time.created,
      model: `${assistant.providerID}/${assistant.modelID}`,
      input: totalInput,
      output: totalOutput,
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
