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

/** A request the call sent into a session; `turn` is how many times the user had spoken when it was made. */
export type SentPrompt = { sessionID: string; promptID: string; title: string; instruction: string; turn?: number }

/**
 * How work the call started ended, for the voice agent to tell the user: one notice per run, naming every request the
 * run's reply answers, as the iOS app's ReplyWatch resolves them.
 */
export type VoiceReply = {
  sessionID: string
  title: string
  /** The requests it answers, oldest first. */
  prompts: SentPrompt[]
  /** What makes it once: the reply's message, or the idle boundary when there's no text. */
  key: string
  outcome: "replied" | "silent" | "failed"
  text?: string
  error?: string
  /** It's the result of a subagent a voice request started in the background. */
  background?: true
}

type Group = { prompts: (SentPrompt & { background?: true })[]; reply?: { messageID: string; text: string } }

/** The run reconcile is reading: requests waiting for its reply, and groups the next request already closed. */
type Run = Group & { closed: Group[] }

/** How a voice request, or background work one started, ended. */
type Settled = SentPrompt & { background?: true; outcome: VoiceReply["outcome"]; text?: string }

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

  /** Sessions with a request whose run hasn't ended yet. */
  unsettled() {
    return [
      ...new Set(
        [...this.prompts.values()].flatMap((prompt) => (this.settled.has(prompt.promptID) ? [] : [prompt.sessionID])),
      ),
    ]
  }

  /** The newest request the call sent into a session, for reading the reply to it. */
  latest(sessionID: string) {
    return [...this.prompts.values()].findLast((prompt) => prompt.sessionID === sessionID)?.promptID
  }

  heard(sessionID: string, keys: string[]) {
    keys.forEach((key) => this.delivered.add(`${sessionID}:${key}`))
  }

  isHeard(reply: VoiceReply) {
    return this.delivered.has(`${reply.sessionID}:${reply.key}`)
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

  // History is in delivery order, not admission-ID order, and only an idle boundary settles a run. Requests steered in
  // before the run has text share its reply; once it has text, the next request closes that reply off, so a later
  // request never donates its answer to an earlier one. A subagent a voice request's run started in the background
  // reports back as a synthetic message; the session's reply after it is that work's result, so it is announced too,
  // once, like the iOS app's background results.
  reconcile(sessionID: string, messages: readonly SessionMessageInfo[]): VoiceReply[] {
    const run: Run = { prompts: [], closed: [] }
    const spawned = new Map<string, SentPrompt>()
    const reported = new Set<string>()
    const replies: VoiceReply[] = []

    messages.forEach((message) => {
      if (message.type === "synthetic") {
        const done = Option.getOrUndefined(decodeCompletion(message.metadata))
        const origin = done ? spawned.get(done.childID) : undefined

        if (origin && done) reported.add(done.childID)

        // Mid-run, the run's own reply covers the subagent's result.
        if (origin && run.prompts.length) return

        if (origin) {
          run.prompts = [{ ...origin, promptID: message.id, background: true }]
          run.reply = undefined

          return
        }
      }

      if (message.type === "user" || message.type === "synthetic") {
        const prompt = this.prompts.get(message.id)

        if (run.reply) {
          run.closed.push({ prompts: run.prompts, reply: run.reply })
          run.prompts = []
          run.reply = undefined
        }

        if (prompt?.sessionID === sessionID) run.prompts.push(prompt)

        return
      }

      if (message.type === "assistant" && run.prompts.length && message.time.completed && !message.error) {
        const origin = run.prompts[run.prompts.length - 1]
        message.content.forEach((part) => {
          if (part.type !== "tool" || part.name !== "subagent" || part.state.status !== "completed") return
          const description = Option.getOrUndefined(decodeDescription(part.state.input))?.description

          // A subagent still running when its tool returned was started in the background.
          const backgrounded = Option.getOrUndefined(decodeBackgrounded(part.state.metadata))

          if (backgrounded)
            spawned.set(backgrounded.sessionID, { ...origin, instruction: description ?? origin.instruction })
        })

        const text = message.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n")
          .trim()

        if (text) run.reply = { messageID: message.id, text }

        return
      }

      if (message.type !== "idle") return

      const groups = [...run.closed.map((group) => ({ ...group, last: false })), { ...run, last: true }]

      groups.forEach((group) => {
        if (!group.prompts.length) return
        const failed = group.last && message.outcome === "failed"
        const outcome = failed ? "failed" : group.reply ? "replied" : "silent"
        const first = group.prompts[0]

        group.prompts.forEach((prompt) =>
          this.settled.set(prompt.promptID, { ...prompt, outcome, text: group.reply?.text }),
        )

        const reply: VoiceReply = {
          sessionID,
          title: first.title,
          prompts: group.prompts,
          key: group.reply?.messageID ?? `idle:${message.id}`,
          outcome,
          text: group.reply?.text,
          error: failed ? (message.error?.message ?? "The run failed.") : undefined,
          background: first.background,
        }

        if (!this.isHeard(reply)) replies.push(reply)
      })

      run.prompts = []
      run.reply = undefined
      run.closed = []
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

  if (!work.text) return "finished without a reply."
  const text = work.text.replace(/\s+/g, " ").trim()

  return text.length > 160
    ? `finished — ${text.slice(0, 159)}… (excerpt; read_session of that session has the whole reply)`
    : `finished — ${text}`
}
