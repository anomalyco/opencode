import type { Page } from "@playwright/test"
import { Schema } from "effect"

// Reads committed inline prompt text so reload tests do not race the draft writer.
export async function readSessionDraftText(page: Page, sessionID: string) {
  const raw = await page.evaluate(async (sessionID) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("opencode-drafts", 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    try {
      const transaction = db.transaction("documents", "readonly")
      const documents = transaction.objectStore("documents")

      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = documents.getAllKeys()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      const key = keys.find((key) => String(key).endsWith(`:session:${sessionID}:prompt`))

      if (key === undefined) return null

      return await new Promise<unknown>((resolve, reject) => {
        const request = documents.get(key)
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      db.close()
    }
  }, sessionID)

  if (raw === null) return ""

  const draft = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        prompt: Schema.Array(Schema.Struct({ type: Schema.String, content: Schema.optional(Schema.Unknown) })),
      }),
    ),
  )(raw)

  return draft.prompt
    .filter((part) => part.type === "text")
    .map((part) => Schema.decodeUnknownSync(Schema.String)(part.content))
    .join("")
}
