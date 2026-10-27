import type { SessionInfo } from "@opencode/client/promise"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { Platform } from "@/runtime/platform/platform"
import { VoiceGates } from "./gates"
import { TranscriptTail } from "./tail"
import { VoiceTools } from "./tools"
import { VoiceFailure, VoiceTransport } from "./transport"
import { delegatorInstructions } from "./spec"
import type { ToolCall, VoiceEvent } from "./protocol"

export type CallState = {
  status: "idle" | "connecting" | "connected" | "dropped"
  failure?: "unavailable" | "microphone" | "dropped" | "connection"
  muted: boolean
  level: number
  caption: string
  speaker: "user" | "assistant"
  utterance?: number
  title: string
}

type Delegation = {
  id: string
  sessionID: string
  transcript: string[]
  calls: ToolCall[]
  rounds: number
  responseID?: string
}

export function createVoiceCall(input: {
  ctx: ServerCtx
  session: SessionInfo
  platform: Platform
  /** Shows the session on screen; rejects unless the route really changed. */
  open: (session: SessionInfo, signal: AbortSignal) => Promise<void>
  /** Session IDs with an open tab. */
  tabs: () => string[]
  change: (state: Partial<CallState>) => void
}) {
  const tail = new TranscriptTail()
  let gates = new VoiceGates()

  const tools = new VoiceTools(input.ctx, {
    open: async (session, signal) => {
      await input.open(session, signal)
      // A call that ended or dropped mid-open must not take over the view.
      signal.throwIfAborted()
      view(session)
    },
    tabs: input.tabs,
  })

  const state: {
    transport?: VoiceTransport
    viewing: SessionInfo
    muted: boolean
    ended: boolean
    watching: boolean
    ready: boolean
    joining: boolean
  } = {
    viewing: input.session,
    muted: false,
    ended: false,
    watching: false,
    ready: false,
    joining: false,
  }

  const delegations = new Map<string, Delegation>()
  const completed = new Set<string>()
  const dirty = new Set<string>()
  const unlisten = input.ctx.sdk.event.on("session.idle", (event) => dirty.add(event.data.sessionID))

  const timer = setInterval(() => {
    void watch()
  }, 1000)

  let updates = Promise.resolve()

  function view(session: SessionInfo) {
    state.viewing = session
    input.change({ title: session.title ?? session.id })
    const transport = state.transport

    if (!state.ready || !transport) return
    updates = updates
      .then(async () => {
        if (transport !== state.transport || transport.abort.signal.aborted) return
        await transport.instructions(delegatorInstructions(state.viewing, tail.lines))
      })
      .catch(() => {
        if (transport === state.transport && !transport.abort.signal.aborted) drop("connection")
      })
  }

  function drop(failure: CallState["failure"] = "dropped") {
    if (state.ended) return
    state.ready = false
    delegations.forEach((delegation) => tail.release(delegation.id))
    delegations.clear()
    input.change({ status: "dropped", failure, level: 0 })
    void state.transport?.close()
    void input.platform.setVoiceCallActive?.(false).catch(() => undefined)
  }

  async function join() {
    if (state.ended || state.joining || state.ready) return
    state.joining = true
    input.change({ status: "connecting", failure: undefined })
    await connect()
      .catch((error: unknown) => {
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
        gates.user(!state.muted && mic > 0.015)
        gates.assistant(speaker > 0.005)
        input.change({ level: Math.min(1, (state.muted ? speaker : Math.max(mic, speaker)) * 5) })
      },
      dropped: () => {
        if (state.transport === transport) drop()
      },
    })

    state.transport = transport

    if (input.platform.requestMicrophone && !(await input.platform.requestMicrophone()))
      throw new VoiceFailure("microphone")
    transport.abort.signal.throwIfAborted()
    await input.platform.setVoiceCallActive?.(true)
    transport.abort.signal.throwIfAborted()
    await transport.join(state.viewing, tail.lines)
    transport.abort.signal.throwIfAborted()
    state.ready = true
    transport.mute(state.muted)
    // Navigation while connecting must reach the newly ready backend too.
    view(state.viewing)
    tools.replies.sessions.forEach((id) => dirty.add(id))
    input.change({ status: "connected", muted: state.muted })
  }

  function eventReceived(event: VoiceEvent, transport: VoiceTransport) {
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      const speaker = event.type === "session.input_transcript.delta" ? "user" : "assistant"
      const caption = tail.append(speaker, event.delta ?? "")

      if (speaker === "user") gates.user(true)

      if (speaker === "assistant") gates.assistant(true)
      input.change({ caption, speaker, utterance: tail.latest })

      return
    }

    if (event.type === "session.delegation.created" && event.delegation) {
      const id = event.delegation.id

      if (delegations.has(id)) return
      delegations.set(id, { id, sessionID: state.viewing.id, transcript: tail.capture(id), calls: [], rounds: 0 })

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
      drop("connection")

      return
    }

    if (!delegation.calls.length) {
      // Responses final text goes to Live directly; never append it again.
      tools.answered(delegation.id)
      tail.accept(delegation.id)
      delegations.delete(delegation.id)
      gates.answer()

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
      outputs.push({ call_id: call.call_id, output: await tools.run(call, delegation, transport.abort.signal) })
    }

    transport.abort.signal.throwIfAborted()
    outputs.forEach((output) =>
      transport.send({ type: "response.item.create", item: { type: "function_call_output", ...output } }),
    )
    transport.send({ type: "response.create" })
    tools.replies.sessions.forEach((id) => dirty.add(id))
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
              content: `Result from session ${JSON.stringify(reply.title.slice(0, 100))}, request ${JSON.stringify(reply.instruction.slice(0, 100))}: ${text}`,
            })
            tools.replies.heard(sessionID, [reply.messageID])
            gates.released()
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
    join,
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
      await Promise.all([state.transport?.close(), input.platform.setVoiceCallActive?.(false).catch(() => undefined)])
    },
  }
}
