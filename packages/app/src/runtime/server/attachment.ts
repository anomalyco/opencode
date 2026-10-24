import { AttachmentReference } from "@opencode/client/attachment-reference"
import type { PromptFileAttachment, SessionMessageUser } from "@opencode/client/promise"
import type { ServerApi } from "./api"

const MAX_MESSAGES = 32

const MAX_BYTES = 16 * 1024 * 1024

/** One server's original user messages, shared by display, Revert and Fork; bounded by count and bytes. */
export function createAttachmentReader(read: ServerApi["session"]["message"]["get"]) {
  const pending = new Map<string, Promise<SessionMessageUser>>()
  const resolved = new Map<string, { message: SessionMessageUser; bytes: number }>()
  let bytes = 0

  const load = (sessionID: string, messageID: string) => {
    const key = `${sessionID}/${messageID}`
    const cached = resolved.get(key)

    if (cached) {
      resolved.delete(key)
      resolved.set(key, cached)

      return Promise.resolve(cached.message)
    }

    const existing = pending.get(key)

    if (existing) return existing

    const request = read({ sessionID, messageID })
      .then((message) => {
        if (message?.type !== "user" || message.files?.some(AttachmentReference.is))
          throw new Error("Original attachment message is unavailable")
        // Count UTF-16 storage conservatively. Oversized originals may be shown but are not retained.
        const size = JSON.stringify(message).length * 2

        if (size <= MAX_BYTES) {
          resolved.set(key, { message, bytes: size })
          bytes += size

          for (const [oldest, entry] of resolved) {
            if (resolved.size <= MAX_MESSAGES && bytes <= MAX_BYTES) break
            bytes -= entry.bytes
            resolved.delete(oldest)
          }
        }

        return message
      })
      .finally(() => pending.delete(key))

    pending.set(key, request)

    return request
  }

  return {
    /** The message with original attachment bytes, for restoring it into a composer. */
    async hydrate(sessionID: string, message: SessionMessageUser) {
      return message.files?.some(AttachmentReference.is) ? load(sessionID, message.id) : message
    },
    async file(file: PromptFileAttachment) {
      const reference = AttachmentReference.parse(file)

      if (!reference) return file
      const original = (await load(reference.sessionID, reference.messageID)).files?.[reference.index]

      if (!original) throw new Error("Original attachment is unavailable")

      return original
    },
  }
}
