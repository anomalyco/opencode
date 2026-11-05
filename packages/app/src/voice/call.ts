import type { SessionInfo } from "@opencode/client/promise"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { Platform } from "@/runtime/platform/platform"
import { VoiceGates } from "./gates"
import { TranscriptTail } from "./tail"
import { VoiceTools } from "./tools"
import { VoiceFailure, VoiceTransport } from "./transport"
import { delegatorInstructions } from "./spec"
import type { VoiceEvent } from "./protocol"
import {
  isConnecting,
  isMuted,
  viewedSession,
  type VoiceCallEvent,
  type VoiceCallState,
  type VoiceFailureReason,
  type VoiceViewedSession,
} from "./call-machine"
import {
  createVoiceDelegationState,
  delegating,
  responseEvent,
  transitionVoiceDelegation,
  type VoiceDelegationEffect,
  type VoiceDelegationEvent,
} from "./machine"
import {
  createVoiceReplyState,
  replyCommentary,
  transitionVoiceReply,
  type VoiceReplyEffect,
  type VoiceReplyEvent,
} from "./reply-machine"

/** Runs one call's transports, tools and delegations for the call machine in `context.tsx`. */
export function createVoiceCall(input: {
  ctx: ServerCtx
  platform: Platform
  /** Shows the session on screen; rejects unless the route really changed. */
  open: (session: SessionInfo, signal: AbortSignal) => Promise<void>
  /** Session IDs with an open tab. */
  tabs: () => string[]
  call: () => VoiceCallState<ServerCtx>
  dispatch: (event: VoiceCallEvent<ServerCtx>) => void
}) {
  const tail = new TranscriptTail()
  let gates = new VoiceGates()
  const tools = new VoiceTools(input.ctx, { open: input.open, tabs: input.tabs })

  // The attempt's transport, from the start of its join until it drops or the call ends.
  let connection: { attempt: number; transport: VoiceTransport } | undefined
  let delegations = createVoiceDelegationState()
  // Timers and tool aborts of open delegations; the machine decides when each ends.
  const handles = new Map<string, { timer?: ReturnType<typeof setTimeout>; abort?: AbortController }>()
  let replies = createVoiceReplyState()
  // The reply machine's pending gate or retry timer, and its history read.
  let replyTimer: ReturnType<typeof setTimeout> | undefined
  let replyAbort: AbortController | undefined

  const unlisten = input.ctx.sdk.event.on("session.idle", (event) => {
    if (tools.replies.sessions.includes(event.data.sessionID))
      dispatchReply({ type: "sessions.dirty", sessionIDs: [event.data.sessionID] })
  })

  async function join(attempt: number, viewing: VoiceViewedSession, muted: boolean) {
    // The call may have dropped or ended while the previous transport closed.
    if (!isConnecting(input.call(), attempt)) throw new VoiceFailure("connection")
    gates = new VoiceGates()

    const transport = new VoiceTransport({
      voice: input.ctx.sdk.api.experimental.voice,
      event: (event) => {
        if (connection?.transport === transport) eventReceived(attempt, event)
      },
      levels: (mic, speaker) => {
        if (connection?.transport !== transport) return
        gates.user(!isMuted(input.call()) && mic > 0.015)
        gates.assistant(speaker > 0.005)
        input.dispatch({ type: "level.updated", attempt, mic, speaker })
      },
      dropped: () => {
        if (connection?.transport === transport) input.dispatch({ type: "call.dropped", attempt, failure: "dropped" })
      },
    })

    connection = { attempt, transport }

    if (input.platform.requestMicrophone && !(await input.platform.requestMicrophone()))
      throw new VoiceFailure("microphone")
    transport.signal.throwIfAborted()
    await input.platform.setVoiceCallActive?.(true)
    transport.signal.throwIfAborted()
    await transport.join(viewing, tail.lines)
    transport.signal.throwIfAborted()
    transport.mute(muted)
  }

  /** Sends on the attempt's transport; a send that fails drops that attempt. */
  function send(attempt: number, failure: VoiceFailureReason, write: (transport: VoiceTransport) => void) {
    const transport = connection?.attempt === attempt ? connection.transport : undefined

    if (!transport) return
    void Promise.resolve()
      .then(() => write(transport))
      .catch(() => input.dispatch({ type: "call.dropped", attempt, failure }))
  }

  function instructions(attempt: number, viewing: VoiceViewedSession) {
    send(attempt, "connection", (transport) => transport.instructions(delegatorInstructions(viewing, tail.lines)))
  }

  function eventReceived(attempt: number, event: VoiceEvent) {
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      const speaker = event.type === "session.input_transcript.delta" ? "user" : "assistant"
      const text = tail.append(speaker, event.delta ?? "")
      const utterance = tail.latest

      if (speaker === "user") gates.user(true)

      if (speaker === "assistant") gates.assistant(true)

      if (utterance !== undefined) input.dispatch({ type: "caption.updated", attempt, utterance, speaker, text })

      return
    }

    if (event.type === "session.delegation.created" && event.delegation) {
      const id = event.delegation.id
      const viewing = viewedSession(input.call())

      // A repeated event is harmless: the tail keeps the reservation and the delegation machine ignores it.
      if (!viewing) return
      dispatch({ type: "delegation.created", id, sessionID: viewing.id, transcript: tail.capture(id) })

      return
    }

    // The transport already dropped the call for a fatal error; any other one rejected a single client event.
    if (event.type === "error") console.warn("[voice] Live rejected a client event", event.error)
    const next = responseEvent(event)

    if (next) dispatch(next)
  }

  function dispatch(event: VoiceDelegationEvent) {
    const next = transitionVoiceDelegation(delegations, event)
    delegations = next.state
    next.effects.forEach(perform)
    dispatchReply({ type: "delegations.changed", delegating: delegating(delegations) })
  }

  function perform(effect: VoiceDelegationEffect) {
    if (effect.type === "deadline") {
      const handle = handles.get(effect.id) ?? {}
      clearTimeout(handle.timer)
      handle.timer = setTimeout(
        () =>
          dispatch({
            type: "delegation.timeout",
            id: effect.id,
            attempt: effect.attempt,
            channelOpen: !!connection?.transport.canSend,
          }),
        effect.ms,
      )
      handles.set(effect.id, handle)

      return
    }

    if (effect.type === "round") {
      const transport = connection?.transport

      if (!transport) return
      const abort = new AbortController()
      handles.set(effect.id, { ...handles.get(effect.id), abort })
      void runRound(effect, AbortSignal.any([abort.signal, transport.signal]))

      return
    }

    if (effect.type === "abort") {
      handles.get(effect.id)?.abort?.abort()

      return
    }

    if (effect.type === "outputs") {
      if (!connection) return
      send(connection.attempt, "connection", (transport) => {
        effect.outputs.forEach((output) =>
          transport.send({ type: "response.item.create", item: { type: "function_call_output", ...output } }),
        )
        transport.send({ type: "response.create", event_id: effect.requestID })
        dispatchReply({ type: "sessions.dirty", sessionIDs: tools.replies.sessions })
      })

      return
    }

    const handle = handles.get(effect.id)
    clearTimeout(handle?.timer)
    handle?.abort?.abort()
    handles.delete(effect.id)

    if (effect.outcome === "discarded") {
      tools.discard(effect.id)
      tail.release(effect.id)

      return
    }

    // Responses final text goes to Live directly; never append it again.
    dispatchReply({ type: "replies.heard", heard: tools.answered(effect.id) })
    tail.accept(effect.id)
    gates.answer()
  }

  async function runRound(effect: Extract<VoiceDelegationEffect, { type: "round" }>, signal: AbortSignal) {
    // open_session moves the rest of this request onto the session it opened.
    const request = { ...effect.request }

    // Serial execution preserves dependencies between tools in one round.
    for (const call of effect.calls) {
      const output = await tools.run(call, request, signal)
      dispatch({
        type: "tool.completed",
        id: effect.id,
        attempt: effect.attempt,
        sessionID: request.sessionID,
        output: { call_id: call.call_id, output },
      })
    }
  }

  function dispatchReply(event: VoiceReplyEvent) {
    const next = transitionVoiceReply(replies, event)
    replies = next.state
    next.effects.forEach(performReply)
  }

  function performReply(effect: VoiceReplyEffect) {
    if (effect.type === "fetch") {
      const abort = new AbortController()
      const timeout = setTimeout(() => abort.abort(), effect.timeout)
      replyAbort = abort
      void tools
        .history(effect.sessionID, abort.signal)
        .then(
          (messages) =>
            dispatchReply({
              type: "fetch.succeeded",
              attempt: effect.attempt,
              sessionID: effect.sessionID,
              replies: tools.replies.reconcile(effect.sessionID, messages),
            }),
          () => dispatchReply({ type: "fetch.failed", attempt: effect.attempt, sessionID: effect.sessionID }),
        )
        .finally(() => clearTimeout(timeout))

      return
    }

    if (effect.type === "fetch.abort") {
      replyAbort?.abort()

      return
    }

    if (effect.type === "hold") {
      // The gates move with speech, so each wait ends by asking them again.
      const check = () => {
        const ms = gates.delay()

        if (!ms) return dispatchReply({ type: "gate.opened", attempt: effect.attempt })
        replyTimer = setTimeout(check, ms)
      }

      clearTimeout(replyTimer)
      replyTimer = setTimeout(check, 0)

      return
    }

    if (effect.type === "retry") {
      clearTimeout(replyTimer)
      replyTimer = setTimeout(() => dispatchReply({ type: "retry.due", attempt: effect.attempt }), effect.ms)

      return
    }

    if (effect.type === "wait.clear") {
      clearTimeout(replyTimer)

      return
    }

    if (!connection) return
    const reply = effect.reply
    send(connection.attempt, "dropped", (transport) => {
      transport.send({ type: "session.commentary.append", delegation_id: null, content: replyCommentary(reply) })
      tools.replies.heard(reply.sessionID, [reply.messageID])
      gates.released()
      gates.answer()
      dispatchReply({ type: "announce.succeeded", attempt: effect.attempt, reply })
    })
  }

  /** Closes the transport and releases the active-call IPC; delegations cannot outlive their transport. */
  function release() {
    const transport = connection?.transport
    connection = undefined
    dispatchReply({ type: "call.disconnected" })
    dispatch({ type: "call.reset" })
    tail.clearReservations()

    if (!transport) return Promise.resolve()

    return Promise.all([transport.close(), input.platform.setVoiceCallActive?.(false).catch(() => undefined)]).then(
      () => undefined,
    )
  }

  return {
    /** Settles once the attempt's result is dispatched. */
    connect(attempt: number, viewing: VoiceViewedSession, muted: boolean) {
      return join(attempt, viewing, muted).then(
        () => input.dispatch({ type: "connect.succeeded", attempt }),
        (error) =>
          input.dispatch({
            type: "connect.failed",
            attempt,
            failure: error instanceof VoiceFailure ? error.reason : "connection",
          }),
      )
    },
    activate(attempt: number, sync?: VoiceViewedSession) {
      if (sync) instructions(attempt, sync)
      dispatchReply({ type: "call.connected", sessionIDs: tools.replies.sessions })
    },
    instructions,
    mute(attempt: number, muted: boolean) {
      send(attempt, "dropped", (transport) => transport.mute(muted))
    },
    disconnect(attempt: number) {
      if (connection?.attempt !== attempt) return Promise.resolve()

      return release()
    },
    dispose() {
      unlisten()
      const released = release()
      dispatchReply({ type: "disposed" })

      return released
    },
  }
}
