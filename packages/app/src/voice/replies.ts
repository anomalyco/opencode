import type { SessionMessageInfo } from "@opencode/client/promise"

export type SentPrompt = { sessionID: string; promptID: string; title: string; instruction: string }

export type VoiceReply = SentPrompt & { messageID: string; text: string }

export class ReplyWatch {
  private prompts = new Map<string, SentPrompt>()
  private delivered = new Set<string>()

  sent(prompt: SentPrompt) {
    this.prompts.set(prompt.promptID, prompt)
  }

  get sessions() {
    return [...new Set([...this.prompts.values()].map((prompt) => prompt.sessionID))]
  }

  pending(sessionID: string) {
    return [...this.prompts.values()]
      .filter((prompt) => prompt.sessionID === sessionID)
      .map((prompt) => prompt.promptID)
  }

  heard(sessionID: string, messageIDs: string[]) {
    messageIDs.forEach((id) => this.delivered.add(`${sessionID}:${id}`))
  }

  // History is in delivery order, not admission-ID order. Only an idle boundary
  // settles a reply. A later user's request must never donate its answer to an
  // earlier voice prompt, even when both were queued before either ran.
  reconcile(sessionID: string, messages: readonly SessionMessageInfo[]): VoiceReply[] {
    const state: { prompt?: SentPrompt; reply?: VoiceReply } = {}
    const replies: VoiceReply[] = []
    messages.forEach((message) => {
      if (message.type === "user" || message.type === "synthetic") {
        const prompt = this.prompts.get(message.id)
        state.prompt = prompt?.sessionID === sessionID ? prompt : undefined
        state.reply = undefined

        return
      }

      if (message.type === "assistant" && state.prompt && message.time.completed && !message.error) {
        const text = message.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n")
          .trim()

        if (text) state.reply = { ...state.prompt, messageID: message.id, text }

        return
      }

      if (message.type !== "idle") return

      if (
        state.reply &&
        message.outcome === "succeeded" &&
        !this.delivered.has(`${sessionID}:${state.reply.messageID}`)
      ) {
        replies.push(state.reply)
      }

      state.prompt = undefined
      state.reply = undefined
    })

    return replies
  }
}
