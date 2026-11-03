import type { SessionMessageInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"

// What the server writes on a subagent's tool part and on the synthetic message that reports a background one back.
const decodeCompletion = Schema.decodeUnknownOption(
  Schema.Struct({ source: Schema.Literal("subagent"), childID: Schema.String }),
)

const decodeBackgrounded = Schema.decodeUnknownOption(
  Schema.Struct({ sessionID: Schema.String, status: Schema.Literal("running") }),
)

const decodeDescription = Schema.decodeUnknownOption(Schema.Struct({ description: Schema.String }))

export type SentPrompt = { sessionID: string; promptID: string; title: string; instruction: string }

/** `background`: the reply after a subagent a voice request started in the background finished. */
export type VoiceReply = SentPrompt & { messageID: string; text: string; background?: true }

/** The run reconcile is reading: the request it answers, and its reply so far. */
type Run = { prompt?: SentPrompt & { background?: true }; reply?: VoiceReply }

/** How a voice request, or background work one started, ended. */
type Settled = SentPrompt & { background?: true; outcome: "succeeded" | "failed" | "interrupted"; text?: string }

export class ReplyWatch {
  private prompts = new Map<string, SentPrompt>()
  private delivered = new Set<string>()
  private settled = new Map<string, Settled>()
  /** Background subagents each session's voice requests started that haven't reported back, by session. */
  private background = new Map<string, (SentPrompt & { child: string })[]>()

  sent(prompt: SentPrompt) {
    this.prompts.set(prompt.promptID, prompt)
  }

  get sessions() {
    return [...new Set([...this.prompts.values()].map((prompt) => prompt.sessionID))]
  }

  pending(sessionID: string) {
    return [...this.prompts.values()].flatMap((prompt) => (prompt.sessionID === sessionID ? [prompt.promptID] : []))
  }

  heard(sessionID: string, messageIDs: string[]) {
    messageIDs.forEach((id) => this.delivered.add(`${sessionID}:${id}`))
  }

  /** This call's session work for the delegator, as on iOS: what's still running, then the latest results. */
  tracked() {
    const label = (work: SentPrompt) =>
      `${JSON.stringify(work.title)} (id ${work.sessionID}, request ${quote(work.instruction)})`

    const running = [...this.prompts.values()].flatMap((prompt) =>
      this.settled.has(prompt.promptID) ? [] : [`- ${label(prompt)}: working; its reply is spoken when it lands.`],
    )

    const background = [...this.background.values()].flatMap((list) =>
      list.map(
        (work) =>
          `- Background work ${quote(work.instruction)} that ${JSON.stringify(work.title)} started (subagent session id ${work.child}): working; its result is spoken when it lands.`,
      ),
    )

    const done = [...this.settled.values()].slice(-4).map((work) => {
      const name = work.background
        ? `Background work ${quote(work.instruction)} that ${JSON.stringify(work.title)} started`
        : label(work)

      return `- ${name}: ${ending(work)}`
    })

    return [...running, ...background, ...done]
  }

  // History is in delivery order, not admission-ID order. Only an idle boundary
  // settles a reply. A later user's request must never donate its answer to an
  // earlier voice prompt, even when both were queued before either ran.
  // A subagent a voice request's run started in the background reports back
  // as a synthetic message; the session's reply after it is that work's
  // result, so it is announced too, once, like the iOS app's background results.
  reconcile(sessionID: string, messages: readonly SessionMessageInfo[]): VoiceReply[] {
    const state: Run = {}
    const spawned = new Map<string, SentPrompt>()
    const reported = new Set<string>()
    const replies: VoiceReply[] = []
    messages.forEach((message) => {
      if (message.type === "synthetic") {
        const done = Option.getOrUndefined(decodeCompletion(message.metadata))
        const origin = done ? spawned.get(done.childID) : undefined

        if (origin && done) reported.add(done.childID)

        // Mid-run, the run's own reply covers the subagent's result.
        if (origin && state.prompt) return

        if (origin) {
          state.prompt = { ...origin, promptID: message.id, background: true }
          state.reply = undefined

          return
        }
      }

      if (message.type === "user" || message.type === "synthetic") {
        const prompt = this.prompts.get(message.id)
        state.prompt = prompt?.sessionID === sessionID ? prompt : undefined
        state.reply = undefined

        return
      }

      if (message.type === "assistant" && state.prompt && message.time.completed && !message.error) {
        const prompt = state.prompt
        message.content.forEach((part) => {
          if (part.type !== "tool" || part.name !== "subagent" || part.state.status !== "completed") return
          const description = Option.getOrUndefined(decodeDescription(part.state.input))?.description

          // A subagent still running when its tool returned was started in the background.
          const backgrounded = Option.getOrUndefined(decodeBackgrounded(part.state.metadata))

          if (backgrounded)
            spawned.set(backgrounded.sessionID, { ...prompt, instruction: description ?? prompt.instruction })
        })

        const text = message.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n")
          .trim()

        if (text) state.reply = { ...prompt, messageID: message.id, text }

        return
      }

      if (message.type !== "idle") return

      if (state.prompt)
        this.settled.set(state.prompt.promptID, { ...state.prompt, outcome: message.outcome, text: state.reply?.text })

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

    this.background.set(
      sessionID,
      [...spawned].flatMap(([child, origin]) => (reported.has(child) ? [] : [{ ...origin, child }])),
    )

    return replies
  }
}

function quote(text: string) {
  return JSON.stringify(text.length > 100 ? `${text.slice(0, 99)}…` : text)
}

// An excerpt, not the reply: read_session has all of it.
function ending(work: Settled) {
  if (work.outcome === "failed") return "failed."

  if (work.outcome === "interrupted") return "was interrupted."

  if (!work.text) return "finished without a reply."
  const text = work.text.replace(/\s+/g, " ").trim()

  return text.length > 160
    ? `finished — ${text.slice(0, 159)}… (excerpt; read_session of that session has the whole reply)`
    : `finished — ${text}`
}
