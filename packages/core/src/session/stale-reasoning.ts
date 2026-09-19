import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Database } from "../database/database"
import { SessionMessage } from "./message"
import type { SessionSchema } from "./schema"
import { SessionMessageTable } from "./sql"

const encodeMessage = Schema.encodeSync(SessionMessage.Message)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stripOpenaiReplay = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) return { metadata, changed: false }
  const openai = metadata.openai
  if (!isRecord(openai)) return { metadata, changed: false }
  if (!("reasoningEncryptedContent" in openai) && !("itemId" in openai)) return { metadata, changed: false }
  const nextOpenai = { ...openai }
  delete nextOpenai.reasoningEncryptedContent
  delete nextOpenai.itemId
  const next = { ...metadata }
  if (Object.keys(nextOpenai).length === 0) delete next.openai
  else next.openai = nextOpenai
  return { metadata: Object.keys(next).length === 0 ? undefined : next, changed: true }
}

export const persist = Effect.fn("SessionStaleReasoning.persist")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  messages: readonly SessionMessage.Message[],
) {
  for (const message of messages) {
    if (message.type !== "assistant") continue
    let changed = false
    const content = message.content.map((item) => {
      if (item.type !== "reasoning") return item
      const stripped = stripOpenaiReplay(item.providerMetadata as Record<string, unknown> | undefined)
      if (!stripped.changed) return item
      changed = true
      return { ...item, providerMetadata: stripped.metadata }
    })
    if (!changed) continue
    const encoded = encodeMessage({ ...message, content })
    const data = Object.fromEntries(Object.entries(encoded).filter(([key]) => key !== "id" && key !== "type"))
    yield* db
      .update(SessionMessageTable)
      .set({ data: data as typeof SessionMessageTable.$inferInsert.data })
      .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.id, message.id)))
      .run()
      .pipe(Effect.orDie)
  }
})

export * as SessionStaleReasoning from "./stale-reasoning"
