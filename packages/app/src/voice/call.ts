import type { SessionInfo } from "@opencode/client/promise"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { Platform } from "@/runtime/platform/platform"
import { VoiceGates } from "./gates"
import { VoiceSounds } from "./sounds"
import { TranscriptTail } from "./tail"
import { VoiceTools } from "./tools"
import { VoiceFailure, VoiceTransport } from "./transport"
import {
  deliveredBeforeFailure,
  delegatorInstructions,
  lastRoundNote,
  liveInstructions,
  outOfRounds,
  progressLine,
  requestFailed,
  resultNotice,
  retargetInstructions,
  toolActivity,
  type CallScreen,
} from "./spec"
import type { ToolCall, VoiceEvent } from "./protocol"
import type { VoiceReply } from "./replies"
import { chunks, recentLines, spoken } from "./messages"
import { folder } from "./search"
import { viewDirectory, viewTitle, type VoiceView } from "./view"

export type CallState = {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "dropped"
  failure?: "unavailable" | "microphone" | "dropped" | "connection"
  /** What the voice service said when it refused the call, such as a quota or a safety filter. */
  detail?: string
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
  /** A move the voice agent hasn't heard about yet, and who made it. */
  retarget?: "user" | "agent"
  /** The session open_session is showing: its move is the agent's, not the user's. */
  opening?: string
  /** A move's update for the voice agent, held until it can't cut anyone off, and since when. */
  context?: string
  contextAt?: number
  contextTimer?: ReturnType<typeof setTimeout>
  /** Notices for the voice agent, such as a failed request, waiting for a quiet moment; they outlast a reconnect. */
  notices: string[]
  noticeTimer?: ReturnType<typeof setTimeout>
  /** Results waiting to be spoken, and when each arrived. */
  held: { reply: VoiceReply; at: number }[]
  /** Results already spoken this call, the silent memory a reconnected session gets, as on iOS. */
  spoken: string[]
  /** Since when the user has been talking over the agent's speech. */
  over?: { since: number; last: number }
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
  /** How many times the user had spoken when it was asked. */
  turn: number
  /** The sessions its messages reached. */
  sent?: string[]
  /** Its share of the conversation is taken once the user's last words have settled. */
  settle?: ReturnType<typeof setTimeout>
  settled: boolean
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
    spoke: (signal) =>
      new Promise<void>((resolve) => {
        const heard = () => resolve()
        listeners.add(heard)
        signal.addEventListener("abort", () => listeners.delete(heard), { once: true })
      }),
  })

  // Waiting for the user's next words, such as a delegator's wait that ends when they speak.
  const listeners = new Set<() => void>()

  const state: CallRuntime = {
    viewing: input.view,
    muted: false,
    ended: false,
    watching: false,
    ready: false,
    joining: false,
    attempts: 0,
    notices: [],
    held: [],
    spoken: [],
  }

  const delegations = new Map<string, Delegation>()
  const completed = new Set<string>()
  const dirty = new Set<string>()

  // A session's run ended, as iOS watches it: its reply is read and spoken. A run a steer interrupts carries on, so
  // that isn't an end.
  const unlisten = [
    input.ctx.sdk.event.on("session.execution.succeeded", (event) => dirty.add(event.data.sessionID)),
    input.ctx.sdk.event.on("session.execution.failed", (event) => dirty.add(event.data.sessionID)),
    input.ctx.sdk.event.on("session.execution.interrupted", (event) => {
      if (event.data.reason !== "superseded") dirty.add(event.data.sessionID)
    }),
  ]

  // As on iOS, each session with work still out also has a long poll on its /wait, re-armed until its run ends, so a
  // missed event never leaves a result unspoken.
  const waits = new Map<string, { abort: AbortController; next: number }>()

  const timer = setInterval(() => {
    progress()
    arm()
    void watch()
    announce()
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
        state.contextAt ??= Date.now()
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
    // A request's answer is on its way while the delegator works, so the update waits for it too, at most 15 s.
    const answering = delegations.size && Date.now() - (state.contextAt ?? 0) < 15_000 ? 250 : 0
    const wait = Math.max(gates.context(), answering)

    if (wait > 0) return void (state.contextTimer = setTimeout(deliver, wait))
    state.context = undefined
    state.contextAt = undefined
    transport.send({ type: "session.instructions.append", delegation_id: null, content })
  }

  function delegator(screen: CallScreen) {
    const moved = state.moved && Date.now() - state.moved.at < moveHint ? state.moved : undefined

    return delegatorInstructions({ screen, tracked: tools.replies.tracked(), moved })
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

  function drop(failure: CallState["failure"] = "dropped", fatal?: string) {
    // A pending retry already covers a second report of the same drop.
    if (state.ended || state.retry) return
    state.ready = false
    // As on iOS, the next voice session hears how open requests ended: one whose messages reached a session says they
    // did, so it's never reported failed and sent again.
    delegations.forEach((delegation) => {
      tail.release(delegation.id)
      clearTimeout(delegation.settle)
      state.notices.push(delegation.sent?.length ? deliveredBeforeFailure(delegation.sent) : requestFailed)
    })
    delegations.clear()
    input.change({ working: false })
    input.levels(0, 0)
    void state.transport?.close()
    const live = state.since !== undefined
    const wait = !fatal && live && (failure === "dropped" || failure === "connection")

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
    // A call that was live and couldn't come back has ended; one that never connected couldn't connect.
    input.change({
      status: "dropped",
      failure: live && failure === "connection" && !fatal ? "dropped" : failure,
      detail: fatal,
    })
    void input.platform.setVoiceCallActive?.(false).catch(() => undefined)
  }

  async function join(retrying = false) {
    if (state.ended || state.joining || state.ready) return
    state.joining = true

    if (!retrying) input.change({ status: "connecting", failure: undefined, detail: undefined })
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
        const talking = !state.muted && mic > 0.015
        gates.voice(talking)
        gates.assistant(speaker > 0.005)
        bargeIn(transport, talking)
        input.levels(state.muted ? 0 : mic, speaker)
      },
      // While joining, a failing transport rejects the join instead, which drops the call once.
      dropped: (fatal) => {
        if (state.transport === transport && state.ready) drop("connection", fatal)
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
    state.contextAt = undefined
    const shown = state.viewing
    const screen = await look(shown)
    transport.abort.signal.throwIfAborted()
    state.screen = screen
    await transport.join(
      {
        live: liveInstructions(
          screen,
          state.since !== undefined && tail.lines ? { tail: tail.lines, spoken: state.spoken } : undefined,
        ),
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
    flush()
  }

  function eventReceived(event: VoiceEvent, transport: VoiceTransport) {
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      const speaker = event.type === "session.input_transcript.delta" ? "user" : "assistant"
      const caption = tail.append(speaker, event.delta ?? "")

      if (speaker === "user") {
        gates.words()
        // A request's share of the conversation waits for the user's trailing words, as on iOS.
        delegations.forEach((delegation) => delegation.settle && schedule(delegation))

        if (/[\p{L}\p{N}]/u.test((event.delta ?? "").replace(/\[[^\]]*\]/g, ""))) {
          listeners.forEach((heard) => heard())
          listeners.clear()
        }
      }

      if (speaker === "assistant") gates.assistant(true)
      input.change({ caption, speaker, utterance: tail.latest })

      return
    }

    if (event.type === "session.delegation.created" && event.delegation) {
      const id = event.delegation.id

      if (delegations.has(id)) return

      const delegation: Delegation = {
        id,
        sessionID: state.viewing.type === "session" ? state.viewing.session.id : undefined,
        transcript: [],
        calls: [],
        rounds: 0,
        at: Date.now(),
        lines: 0,
        turn: tail.turns,
        settled: false,
      }

      delegations.set(id, delegation)
      schedule(delegation)
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

    // A nested error ends the round as a failure, as on iOS.
    const ends = ["response.completed", "response.failed", "response.incomplete", "response.cancelled", "error"]

    if (!ends.includes(nested.type)) return
    const key = nested.response?.id ?? delegation.responseID ?? `${delegation.id}:${delegation.rounds}`

    if (completed.has(key)) return
    completed.add(key)

    if (nested.type !== "response.completed") {
      // One request failing leaves the call up; its words go to the next request. One whose messages reached a session
      // says so, as on iOS, so the work is never reported failed and sent again.
      close(delegation)
      tail.release(delegation.id)

      if (delegation.sent?.length) say(deliveredBeforeFailure(delegation.sent))
      else if (nested.type !== "response.cancelled") say(requestFailed)

      return
    }

    if (!delegation.calls.length) {
      // Responses final text goes to Live directly; never append it again.
      tools.answered(delegation.id)
      tail.accept(delegation.id)
      close(delegation)
      gates.answer()

      if (delegation.ending) hangup(transport)

      return
    }

    const calls = delegation.calls.splice(0)
    void runRound(delegation, calls, transport).catch(() => {
      if (state.transport === transport && !transport.abort.signal.aborted) drop("connection")
    })
  }

  // Fifty rounds at most, as on iOS: the last one's results ask for an answer, and a request that still wants tools
  // ends with a line saying any work it sent keeps going.
  async function runRound(delegation: Delegation, calls: ToolCall[], transport: VoiceTransport) {
    if (delegation.rounds >= 49) {
      close(delegation)
      tail.release(delegation.id)

      return say(outOfRounds)
    }

    delegation.rounds++
    settle(delegation)
    // Serial execution preserves dependencies between tools in one round.
    const outputs: { call_id: string; output: string }[] = []

    for (const call of calls) {
      transport.abort.signal.throwIfAborted()

      if (call.name === "end_call") delegation.ending = true
      delegation.activity = toolActivity.get(call.name)

      // Tool ticks play only on a live, unmuted call, and never over the agent's speech, as on iOS.
      if (!state.muted && !gates.speaking) VoiceSounds.tool(call.name)
      outputs.push({ call_id: call.call_id, output: await tools.run(call, delegation, transport.abort.signal) })
    }

    delegation.activity = undefined

    transport.abort.signal.throwIfAborted()
    outputs.forEach((output) =>
      transport.send({ type: "response.item.create", item: { type: "function_call_output", ...output } }),
    )

    if (delegation.rounds === 49)
      transport.send({
        type: "response.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: lastRoundNote }] },
      })
    transport.send({ type: "response.create" })
    tools.replies.sessions.forEach((id) => dirty.add(id))
  }

  function close(delegation: Delegation) {
    clearTimeout(delegation.settle)
    delegations.delete(delegation.id)
    input.change({ working: delegations.size > 0 })
  }

  // A request's share of the conversation is taken 180 ms after the user's last words, so a trailing fragment isn't
  // left out of its handoff, as on iOS.
  function schedule(delegation: Delegation) {
    clearTimeout(delegation.settle)
    delegation.settle = setTimeout(() => settle(delegation), 180)
  }

  function settle(delegation: Delegation) {
    clearTimeout(delegation.settle)
    delegation.settle = undefined

    if (delegation.settled) return
    delegation.settled = true
    delegation.transcript.push(...tail.capture(delegation.id))
  }

  /** A notice for the voice agent, sent once nobody is speaking and no answer is due. */
  function say(content: string) {
    state.notices.push(content)
    flush()
  }

  function flush() {
    clearTimeout(state.noticeTimer)
    const transport = state.transport
    const content = state.notices[0]

    if (!state.ready || !transport || content === undefined) return
    const wait = gates.delay()

    if (wait > 0) return void (state.noticeTimer = setTimeout(flush, wait))
    state.notices.shift()
    transport.send({ type: "session.commentary.append", delegation_id: null, content })
    gates.answer()

    if (state.notices.length) state.noticeTimer = setTimeout(flush, 1200)
  }

  // As on iOS, the user's voice over the agent's speech for 0.6 s, gaps under 250 ms allowed, stops that speech once
  // their words have come through since it began.
  function bargeIn(transport: VoiceTransport, talking: boolean) {
    const now = Date.now()

    if (!talking || !gates.speaking) {
      if (state.over && now - state.over.last > 250) state.over = undefined

      return
    }

    state.over = state.over && now - state.over.last <= 250 ? { ...state.over, last: now } : { since: now, last: now }

    if (now - state.over.since < 600 || !gates.talkingOver) return
    state.over = undefined
    transport.interrupt()
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

  // Hangs up once the goodbye has played, as iOS waits for the agent's next utterance to finish: its speech starts and
  // goes quiet, at most 8 s.
  function hangup(transport: VoiceTransport) {
    const started = Date.now()
    const goodbye = { heard: false }
    input.change({ ending: true })

    const timer = setInterval(() => {
      if (state.ended || transport !== state.transport) return clearInterval(timer)

      if (gates.speaking) goodbye.heard = true
      const done = goodbye.heard && gates.delay() === 0

      if (!done && Date.now() - started < 8000) return
      clearInterval(timer)
      input.hangup()
    }, 250)
  }

  function arm() {
    const unsettled = tools.replies.unsettled()
    const now = Date.now()

    waits.forEach((wait, sessionID) => {
      if (!unsettled.includes(sessionID)) {
        wait.abort.abort()
        waits.delete(sessionID)
      }
    })

    unsettled.forEach((sessionID) => {
      const known = waits.get(sessionID)

      if (known && (!known.abort.signal.aborted || now < known.next)) return
      const abort = new AbortController()
      const started = Date.now()
      waits.set(sessionID, { abort, next: Infinity })

      // A poll that returns at once, such as for a request still queued behind idle work, waits 10 s before the next.
      void input.ctx.sdk.api.experimental.session
        .wait({ sessionID }, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) })
        .then(
          () => dirty.add(sessionID),
          () => undefined,
        )
        .finally(() => {
          if (waits.get(sessionID)?.abort !== abort) return
          abort.abort()
          waits.set(sessionID, { abort, next: Date.now() + (Date.now() - started < 5000 ? 10_000 : 0) })
        })
    })
  }

  // Reads sessions whose run ended and holds what settled until it can be spoken.
  async function watch() {
    const transport = state.transport

    if (!state.ready || !transport || state.watching || !dirty.size) return
    state.watching = true
    await Promise.resolve()
      .then(async () => {
        for (const sessionID of [...dirty]) {
          dirty.delete(sessionID)

          if (!tools.replies.sessions.includes(sessionID)) continue
          const messages = await tools.history(sessionID, transport.abort.signal)
          const replies = tools.replies.reconcile(sessionID, messages)
          replies.forEach((reply) => {
            if (!state.held.some((item) => item.reply.sessionID === reply.sessionID && item.reply.key === reply.key))
              state.held.push({ reply, at: Date.now() })
          })
        }
      })
      .catch(() => {
        tools.replies.sessions.forEach((id) => dirty.add(id))
      })
      .finally(() => {
        state.watching = false
      })
    announce()
  }

  // Speaks one held result per quiet moment. While the delegator works on a request it may answer about that work
  // itself, so results wait for it, but at most 20 s from arriving, as on iOS; one it already read isn't spoken twice.
  function announce() {
    const transport = state.transport

    if (!state.ready || !transport) return
    state.held = state.held.filter((item) => !tools.replies.isHeard(item.reply))
    const now = Date.now()
    const next = state.held.find((item) => !delegations.size || now - item.at >= 20_000)

    if (!next || gates.delay() > 0) return
    state.held = state.held.filter((item) => item !== next)
    const reply = next.reply
    const text = reply.text ? spoken(reply.text) : undefined
    const turn = Math.min(...reply.prompts.map((prompt) => prompt.turn ?? Infinity))
    chunks(resultNotice(reply, text, tail.turns > turn)).forEach((content) =>
      transport.send({ type: "session.commentary.append", delegation_id: null, content }),
    )
    tools.replies.heard(reply.sessionID, [reply.key])
    gates.answer()
    // What was spoken is what a reconnected session may recap, as on iOS: the last six, briefly.
    const said = `${reply.title}: ${reply.outcome === "failed" ? `failed (${reply.error})` : (text ?? "finished without a reply")}`
    state.spoken = [...state.spoken, said.length > 300 ? `${said.slice(0, 299)}…` : said].slice(-6)
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
      unlisten.forEach((stop) => stop())
      waits.forEach((wait) => wait.abort.abort())
      clearInterval(timer)
      clearTimeout(state.retry)
      clearTimeout(state.notice)
      clearTimeout(state.contextTimer)
      clearTimeout(state.noticeTimer)
      delegations.forEach((delegation) => clearTimeout(delegation.settle))
      await Promise.all([state.transport?.close(), input.platform.setVoiceCallActive?.(false).catch(() => undefined)])
    },
  }
}
