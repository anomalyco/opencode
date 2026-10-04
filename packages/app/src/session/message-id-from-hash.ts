import { SessionMessage } from "@opencode/schema/session-message"

export const messageIdFromHash = (hash: string) => {
  const value = hash.startsWith("#") ? hash.slice(1) : hash
  const match = value.match(/^message-(.+)$/)
  if (!match) return
  return SessionMessage.ID.make(match[1], { disableChecks: true })
}
