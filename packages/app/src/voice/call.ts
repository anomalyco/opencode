import type { SessionInfo } from "@opencode/client/promise"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { Platform } from "@/runtime/platform/platform"
import { VoiceGates } from "./gates"
import { VoiceSounds } from "./sounds"
import { TranscriptTail } from "./tail"
import { VoiceTools } from "./tools"
import { VoiceFailure, VoiceTransport } from "./transport"
import {
  delegatorInstructions,
  liveInstructions,
  progressLine,
  retargetInstructions,
  toolActivity,
  type CallScreen,
} from "./spec"
import type { ToolCall, VoiceEvent } from "./protocol"
import { recentLines } from "./messages"
import { folder } from "./search"
import { viewDirectory, viewTitle, type VoiceView } from "./view"

export type CallState = {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "dropped"
  failure?: "unavailable" | "microphone" | "dropped" | "connection"
  muted: boolean
  /** When the call last connected, for its duration. */
  since?: number
  caption: string
  speaker: "user" | "assistant"
  utterance?: number
  title: string
  /** The delegator is acting on a request. */
  working?: boolean
  /** The delegator hung up; the call ends once its goodbye is spoken. */
  ending?: boolean
}

// After a live call drops, it reconnects on its own this long after each drop, then gives up, as on iOS.
const retries = [500, 2500, 6000]

// How long the delegator keeps the "the screen moved here from…" hint, as on iOS.
const moveHint = 30_000

/** Which screen a view is: a session, or a draft. A rename isn't a move. */
function screenKey(view: VoiceView) {
  return view.type === "session" ? view.session.id : `draft:${view.draftID}`
}

/** A call's own bookkeeping, outside the reactive state the screen reads. */
type CallRuntime = {
  transport?: VoiceTransport
  viewing: VoiceView
  muted: boolean
  ended: boolean
  watching: boolean
  ready: boolean
  joining: boolean
  /** When the call first connected; it has been live, so it reconnects after a drop. */
  since?: number
  attempts: number
  retry?: ReturnType<typeof setTimeout>
  notice?: ReturnType<typeof setTimeout>
  /** What both agents were last told about the screen. */
  screen?: CallScreen
  /** Where the screen last moved from, for the delegator's hint. */
  moved?: { id?: string; title: string; at: number }
  moveTimer?: ReturnType<typeof setTimeout>
  /** A move the voice agent hasn't heard about yet, and who made it. */
  retarget?: "user" | "agent"
  /** The session open_session is showing: its move is the agent's, not the user's. */
  opening?: string
  /** A move's update for the voice agent, held until it can't cut anyone off. */
  context?: string
  contextTimer?: ReturnType<typeof setTimeout>
}

type Delegation = {
  id: string
  /** The session on screen when it was asked; none while the call is still on its draft. */
  sessionID?: string
  transcript: string[]
  calls: ToolCall[]
  rounds: number
  responseID?: string
  /** The delegator called end_call: hang up once its goodbye is spoken. */
  ending?: boolean
  /** When it was asked, for its "still working" lines. */
  at: number
  lines: number
  lineAt?: number
  /** What the delegator is doing right now, as words to say. */
  activity?: string
}

export function createVoiceCall(input: {
  ctx: ServerCtx
  view: VoiceView
  platform: Platform
  /** Shows the session on screen; rejects unless the route really changed. */
  open: (session: SessionInfo, signal: AbortSignal) => Promise<void>
  /** Session IDs with an open tab. */
  tabs: () => string[]
  change: (state: Partial<CallState>) => void
  /** Ends the call, as the user's End does. */
  hangup: () => void
  /** The voice GPT-Live speaks with, read as each voice session starts. */
  voice: () => string
  /** Microphone and speaker levels several times a second; kept out of reactive state. */
  levels: (mic: number, speaker: number) => void
}) {
  const tail = new TranscriptTail()
  let gates = new VoiceGates()

  const tools = new VoiceTools(input.ctx, {
    open: async (session, signal) => {
      state.opening = session.id
      await input
        .open(session, signal)
        .then(() => {
          // A call that ended or dropped mid-open must not take over the view.
          signal.throwIfAborted()
          view({ type: "session", session })
        })
        .finally(() => {
          state.opening = undefined
        })
    },
    tabs: input.tabs,
    draft: () => (state.viewing.type === "draft" ? state.viewing.session() : undefined),
  })

  const state: CallRuntime = {
    viewing: input.view,
    muted: false,
    ended: false,
    watching: false,
    ready: false,
    joining: false,
    attempts: 0,
  }

  const delegations = new Map<string, Delegation>()
  const completed = new Set<string>()
  const dirty = new Set<string>()
  const unlisten = input.ctx.sdk.event.on("session.idle", (event) => dirty.add(event.data.sessionID))

  const timer = setInterval(() => {
    progress()
    void watch()
  }, 1000)

  let updates = Promise.resolve()

  // The screen moved, or its session was renamed. A move is the user's unless open_session made it; `adopted`, the
  // call landing on the session its draft created, isn't one. Both agents hear of it once the screen has been looked at.
  function view(next: VoiceView, adopted = false) {
    const previous = state.viewing
    const moved = !adopted && screenKey(previous) !== screenKey(next)
    state.viewing = next
    input.change({ title: viewTitle(next) })

    if (moved) {
      state.retarget = next.type === "session" && next.session.id === state.opening ? "agent" : "user"
      state.moved = {
        id: previous.type === "session" ? previous.session.id : undefined,
        title: viewTitle(previous),
        at: Date.now(),
      }
      // The hint lapses after 30 s; the delegator is told again without it.
      clearTimeout(state.moveTimer)
      state.moveTimer = setTimeout(instruct, moveHint)
    }

    refresh()
  }

  // Looks at the screen and tells both agents: the delegator what the app shows, and the voice agent, after a move,
  // where it is now. A newer move while looking supersedes this one, and carries its move along.
  function refresh() {
    const transport = state.transport

    if (!state.ready || !transport) return
    const shown = state.viewing
    updates = updates
      .then(async () => {
        const screen = await look(shown)

        if (shown !== state.viewing || transport !== state.transport || transport.abort.signal.aborted) return
        state.screen = screen
        transport.instructions(delegator(screen))
        const by = state.retarget
        state.retarget = undefined

        if (!by) return
        state.context = retargetInstructions(screen, by)
        deliver()
      })
      .catch(() => {
        if (transport === state.transport && !transport.abort.signal.aborted) drop("connection")
      })
  }

  // A move's update waits, like iOS's held context, until nobody is speaking and no reply to the user is due, so
  // switching sessions never cuts the agent off; a newer move replaces one still waiting.
  function deliver() {
    clearTimeout(state.contextTimer)
    const transport = state.transport
    const content = state.context

    if (!state.ready || !transport || !content) return
    const wait = gates.context()

    if (wait > 0) return void (state.contextTimer = setTimeout(deliver, wait))
    state.context = undefined
    transport.send({ type: "session.instructions.append", delegation_id: null, content })
  }

  /** Tells the delegator again from what was last seen: when the move hint lapses, or a result landed. */
  function instruct() {
    const transport = state.transport
    const screen = state.screen

    if (!state.ready || !transport || !screen) return
    updates = updates.then(() => transport.instructions(delegator(screen))).catch(() => undefined)
  }

  function delegator(screen: CallScreen) {
    const moved = state.moved && Date.now() - state.moved.at < moveHint ? state.moved : undefined

    return delegatorInstructions({ screen, tail: tail.lines, tracked: tools.replies.tracked(), moved })
  }

  // The session on screen, its status and recent messages, on a short deadline so a slow server never holds up the
  // call; whatever doesn't answer in time is left out.
  async function look(view: VoiceView): Promise<CallScreen> {
    const project = folder(viewDirectory(view))

    if (view.type !== "session") return { project, recent: [] }
    const session = view.session
    const api = input.ctx.sdk.api
    const signal = AbortSignal.timeout(1000)

    const [active, pending, messages] = await Promise.all([
      api.session.active({ signal }).catch(() => undefined),
      tools.requests(session, signal).catch(() => undefined),
      api.message.list({ sessionID: session.id, order: "desc", limit: 12 }, { signal }).catch(() => undefined),
    ])

    return {
      session: { id: session.id, title: viewTitle(view) },
      project,
      working: active ? session.id in active : undefined,
      needsInput: pending ? pending.permissions.length + pending.forms.length > 0 : undefined,
      recent: messages ? recentLines(messages.data.toReversed()) : [],
    }
  }

  function drop(failure: CallState["failure"] = "dropped") {
    // A pending retry already covers a second report of the same drop.
    if (state.ended || state.retry) return
    state.ready = false
    delegations.forEach((delegation) => tail.release(delegation.id))
    delegations.clear()
    input.change({ working: false })
    input.levels(0, 0)
    void state.transport?.close()
    const wait = state.since !== undefined && (failure === "dropped" || failure === "connection")

    if (wait && state.attempts < retries.length) {
      // A quick recovery stays quiet: the call says it's reconnecting only after a second.
      clearTimeout(state.notice)
      state.notice = setTimeout(() => input.change({ status: "reconnecting" }), 1000)
      state.retry = setTimeout(() => {
        state.retry = undefined
        void join(true)
      }, retries[state.attempts++])

      return
    }

    clearTimeout(state.notice)
    input.change({ status: "dropped", failure })
    void input.platform.setVoiceCallActive?.(false).catch(() => undefined)
  }

  async function join(retrying = false) {
    if (state.ended || state.joining || state.ready) return
    state.joining = true

    if (!retrying) input.change({ status: "connecting", failure: undefined })
    await connect()
      .catch((error) => {
        if (!state.ended) drop(error instanceof VoiceFailure ? error.reason : "connection")
      })
      .finally(() => {
        state.joining = false
      })
  }

  async function connect() {
    await state.transport?.close()

    if (state.ended) return

    gates = new VoiceGates()

    const transport = new VoiceTransport({
      api: input.ctx.sdk.api,
      event: (event) => {
        if (state.transport === transport && !transport.abort.signal.aborted) eventReceived(event, transport)
      },
      levels: (mic, speaker) => {
        gates.voice(!state.muted && mic > 0.015)
        gates.assistant(speaker > 0.005)
        input.levels(state.muted ? 0 : mic, speaker)
      },
      // While joining, a failing transport rejects the join instead, which drops the call once.
      dropped: () => {
        if (state.transport === transport && state.ready) drop()
      },
    })

    state.transport = transport

    if (input.platform.requestMicrophone && !(await input.platform.requestMicrophone()))
      throw new VoiceFailure("microphone")
    transport.abort.signal.throwIfAborted()
    await input.platform.setVoiceCallActive?.(true)
    transport.abort.signal.throwIfAborted()
    // The new voice session starts on the screen as it is now, so no move is pending; a call that was live picks up
    // where it left off, hearing what was said.
    state.retarget = undefined
    state.context = undefined
    const shown = state.viewing
    const screen = await look(shown)
    transport.abort.signal.throwIfAborted()
    state.screen = screen
    await transport.join(
      {
        live: liveInstructions(screen, state.since !== undefined && tail.lines ? tail.lines : undefined),
        delegator: delegator(screen),
      },
      input.voice(),
    )
    transport.abort.signal.throwIfAborted()
    state.ready = true
    state.attempts = 0
    state.since ??= Date.now()
    clearTimeout(state.notice)
    transport.mute(state.muted)

    // Navigation while connecting must reach the newly ready backend too.
    if (state.viewing !== shown || state.retarget) refresh()
    tools.replies.sessions.forEach((id) => dirty.add(id))
    input.change({ status: "connected", muted: state.muted, since: state.since })
  }

  function eventReceived(event: VoiceEvent, transport: VoiceTransport) {
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      const speaker = event.type === "session.input_transcript.delta" ? "user" : "assistant"
      const caption = tail.append(speaker, event.delta ?? "")

      if (speaker === "user") gates.words()

      if (speaker === "assistant") gates.assistant(true)
      input.change({ caption, speaker, utterance: tail.latest })

      return
    }

    if (event.type === "session.delegation.created" && event.delegation) {
      const id = event.delegation.id

      if (delegations.has(id)) return
      delegations.set(id, {
        id,
        sessionID: state.viewing.type === "session" ? state.viewing.session.id : undefined,
        transcript: tail.capture(id),
        calls: [],
        rounds: 0,
        at: Date.now(),
        lines: 0,
      })
      input.change({ working: true })

      return
    }

    if (event.type !== "response.event" || !event.event) return
    const nested = event.event
    // Like iOS, only infer the owner when there is exactly one request.
    const id = event.delegation_id ?? (delegations.size === 1 ? delegations.keys().next().value : undefined)
    const delegation = id ? delegations.get(id) : undefined

    if (!delegation) return

    if (nested.type === "response.created") delegation.responseID = nested.response?.id

    if (nested.type === "response.output_item.done" && nested.item?.type === "function_call") {
      const item = nested.item

      if (item.call_id && item.name && !delegation.calls.some((call) => call.call_id === item.call_id)) {
        delegation.calls.push({ call_id: item.call_id, name: item.name, arguments: item.arguments ?? "{}" })
      }

      return
    }

    if (!["response.completed", "response.failed", "response.incomplete", "response.cancelled"].includes(nested.type))
      return
    const key = nested.response?.id ?? delegation.responseID

    if (!key || completed.has(key)) return
    completed.add(key)

    if (nested.type !== "response.completed") {
      // One request failing leaves the call up; its words go to the next request.
      tail.release(delegation.id)
      delegations.delete(delegation.id)
      input.change({ working: delegations.size > 0 })

      if (nested.type !== "response.cancelled")
        transport.send({
          type: "session.commentary.append",
          delegation_id: null,
          content: "That request failed before it finished. Say so in a few words; nothing from it is confirmed done.",
        })

      return
    }

    if (!delegation.calls.length) {
      // Responses final text goes to Live directly; never append it again.
      tools.answered(delegation.id)
      tail.accept(delegation.id)
      delegations.delete(delegation.id)
      input.change({ working: delegations.size > 0 })
      gates.answer()

      if (delegation.ending) return hangup(transport)
      // What it just sent is tracked work now.
      instruct()

      return
    }

    const calls = delegation.calls.splice(0)
    void runRound(delegation, calls, transport).catch(() => {
      if (state.transport === transport && !transport.abort.signal.aborted) drop("connection")
    })
  }

  async function runRound(delegation: Delegation, calls: ToolCall[], transport: VoiceTransport) {
    if (++delegation.rounds > 50) throw new VoiceFailure("connection")
    // Serial execution preserves dependencies between tools in one round.
    const outputs: { call_id: string; output: string }[] = []

    for (const call of calls) {
      transport.abort.signal.throwIfAborted()

      if (call.name === "end_call") delegation.ending = true
      delegation.activity = toolActivity.get(call.name)

      if (!state.muted) VoiceSounds.tool(call.name)
      outputs.push({ call_id: call.call_id, output: await tools.run(call, delegation, transport.abort.signal) })
    }

    delegation.activity = undefined

    transport.abort.signal.throwIfAborted()
    outputs.forEach((output) =>
      transport.send({ type: "response.item.create", item: { type: "function_call_output", ...output } }),
    )
    transport.send({ type: "response.create" })
    tools.replies.sessions.forEach((id) => dirty.add(id))
  }

  // While the delegator works on a request, the agent says it's still running: once 5 s in, once more 20 s after that,
  // never a third time, and only after 3 s with nobody speaking. A line that can't go waits for the next tick rather
  // than a queue, so it is never spoken after the result.
  function progress() {
    const transport = state.transport

    if (!state.ready || !transport || gates.quiet() < 3000 || gates.delay() > 0) return
    const now = Date.now()

    const delegation = [...delegations.values()].find(
      (item) => item.lines < 2 && now >= (item.lineAt === undefined ? item.at + 5000 : item.lineAt + 20_000),
    )

    if (!delegation) return
    delegation.lines++
    delegation.lineAt = now
    transport.send({
      type: "session.commentary.append",
      delegation_id: null,
      content: progressLine(delegation.activity),
    })
    gates.answer()
  }

  // Hangs up once the goodbye has played: the answer's start window and the agent's speech hold it, at most 8 s.
  function hangup(transport: VoiceTransport) {
    const started = Date.now()
    input.change({ ending: true })

    const timer = setInterval(() => {
      if (state.ended || transport !== state.transport) return clearInterval(timer)

      if (gates.delay() > 0 && Date.now() - started < 8000) return
      clearInterval(timer)
      input.hangup()
    }, 250)
  }

  async function watch() {
    const transport = state.transport

    if (!state.ready || !transport || state.watching || delegations.size || !dirty.size) return
    state.watching = true
    await Promise.resolve()
      .then(async () => {
        for (const sessionID of dirty) {
          if (!tools.replies.sessions.includes(sessionID)) {
            dirty.delete(sessionID)
            continue
          }

          dirty.delete(sessionID)
          const messages = await tools.history(sessionID, transport.abort.signal)
          const replies = tools.replies.reconcile(sessionID, messages)
          // The delegator's tracked work follows what settled.
          instruct()

          if (!replies.length) continue

          for (const reply of replies) {
            if (delegations.size || gates.delay() || transport !== state.transport || transport.abort.signal.aborted) {
              dirty.add(sessionID)

              return
            }

            // One bounded append per result avoids interleaving attribution and
            // content, and stays below Live's 500-token append limit.
            const text = reply.text.replace(/```[\s\S]*?```/g, "[code in session]").slice(0, 800)
            transport.send({
              type: "session.commentary.append",
              delegation_id: null,
              content: reply.background
                ? `Background work finished in session ${JSON.stringify(reply.title.slice(0, 100))}, ${JSON.stringify(reply.instruction.slice(0, 100))}: ${text}`
                : `Result from session ${JSON.stringify(reply.title.slice(0, 100))}, request ${JSON.stringify(reply.instruction.slice(0, 100))}: ${text}`,
            })
            tools.replies.heard(sessionID, [reply.messageID])
            gates.answer()
          }
        }
      })
      .catch(() => {
        tools.replies.sessions.forEach((id) => dirty.add(id))
      })
      .finally(() => {
        state.watching = false
      })
  }

  return {
    join: () => join(),
    view,
    mute() {
      if (!state.ready) return
      state.muted = !state.muted
      state.transport?.mute(state.muted)
      input.change({ muted: state.muted })
    },
    async end() {
      state.ended = true
      state.ready = false
      unlisten()
      clearInterval(timer)
      clearTimeout(state.retry)
      clearTimeout(state.notice)
      clearTimeout(state.moveTimer)
      clearTimeout(state.contextTimer)
      await Promise.all([state.transport?.close(), input.platform.setVoiceCallActive?.(false).catch(() => undefined)])
    },
  }
}
