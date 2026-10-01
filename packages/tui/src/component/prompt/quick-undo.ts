type Message = { id: string; role: string; parentID?: string }
type Part = { type: string; text?: string }

export type Submitted<T> = { sessionID: string; messageID: string; value: T }

export function createQuickUndo<T>() {
  let submitted: Submitted<T> | undefined

  return {
    submitted(next: Submitted<T>) {
      submitted = next
    },
    // A just-sent prompt can be undone until the reply shows the user any text or tool output.
    candidate(sessionID: string, messages: readonly Message[], parts: (messageID: string) => readonly Part[]) {
      if (!submitted || submitted.sessionID !== sessionID) return
      const messageID = submitted.messageID
      const replied = messages.some(
        (message) =>
          message.role === "assistant" &&
          message.parentID === messageID &&
          parts(message.id).some((part) => part.type === "tool" || (part.type === "text" && !!part.text?.trim())),
      )
      if (replied) return
      return submitted
    },
    clear() {
      submitted = undefined
    },
  }
}
