type PromptSubmission = {
  key: number | bigint
  sessionID: string
  messageID?: string
}

export function createPromptSubmission() {
  let pending: PromptSubmission | undefined

  return {
    async begin(key: number | bigint, sessionID?: string) {
      if (pending?.key === key && (sessionID === undefined || pending.sessionID === sessionID)) return pending.sessionID
      if (sessionID !== undefined) {
        pending = { key, sessionID }
        return pending.sessionID
      }
      const { SessionID } = await import("@opencode-ai/schema/session-id")
      pending = {
        key,
        sessionID: SessionID.create(),
      }
      return pending.sessionID
    },
    async message() {
      if (!pending) throw new Error("Prompt submission has not started")
      if (pending.messageID) return pending.messageID
      const { SessionMessage } = await import("@opencode-ai/schema/session-message")
      pending.messageID = SessionMessage.ID.create()
      return pending.messageID
    },
    complete() {
      pending = undefined
    },
  }
}
