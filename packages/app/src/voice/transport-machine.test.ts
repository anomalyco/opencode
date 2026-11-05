import { expect, test } from "bun:test"
import { decodeEvent } from "./protocol"
import {
  CLOSE_TIMEOUT,
  createVoiceTransportState,
  DISCONNECT_GRACE,
  JOIN_TIMEOUT,
  transitionVoiceTransport,
  type VoiceJoinFailure,
  type VoiceTransportEffect,
  type VoiceTransportEvent,
  type VoiceTransportState,
} from "./transport-machine"

function replay(events: VoiceTransportEvent[], start: VoiceTransportState = createVoiceTransportState()) {
  return events.reduce(
    (result: { state: VoiceTransportState; effects: VoiceTransportEffect[] }, event) => {
      const next = transitionVoiceTransport(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: start, effects: [] },
  )
}

type ServerError = { type?: string; code?: string | null; message?: string; event_id?: string }

const wire = (data: { type: string; event_id?: string; error?: ServerError }): VoiceTransportEvent => {
  const event = decodeEvent(JSON.stringify(data))

  if (!event) throw new Error("expected a decodable event")

  return { type: "channel.message", event }
}

const serverError = (error: ServerError) => wire({ type: "error", event_id: "evt_1", error })

const join: VoiceTransportEvent = { type: "join", viewing: { id: "ses_1", title: "One" }, tail: "" }

const started = wire({ type: "session.started", event_id: "evt_started" })

const peer = (state: RTCPeerConnectionState): VoiceTransportEvent => ({ type: "peer.state", state })

const handshake: VoiceTransportEvent[] = [join, { type: "offer.ready", iceComplete: true }, { type: "answer.applied" }]

const connecting = replay(handshake).state

const micStep = replay([started], connecting).state

const live = replay([{ type: "mic.ready" }], micStep).state

const types = (effects: VoiceTransportEffect[]) => effects.map((effect) => effect.type)

test("a rejected client event keeps a live call open, while a session-ending error drops it", () => {
  const rejected = [
    { type: "invalid_request_error", code: "invalid_value", message: "Bad", event_id: "evt_update" },
    { type: "invalid_request_error", code: "conversation_already_has_active_response" },
    { type: "server_error", code: null, message: "Turn failed" },
  ]

  rejected.forEach((error) => {
    const next = transitionVoiceTransport(live, serverError(error))

    expect(next.state).toBe(live)
    expect(next.effects).toEqual([{ type: "forward.event", event: { type: "error", event_id: "evt_1", error } }])
  })

  const fatal = [
    { type: "invalid_request_error", code: "session_expired" },
    { type: "invalid_request_error", code: "invalid_api_key" },
    { type: "insufficient_quota", code: "insufficient_quota" },
    { type: "invalid_request_error", code: "billing_hard_limit_reached" },
    { type: "authentication_error" },
    { type: "permission_error" },
  ]

  fatal.forEach((error) => {
    const next = transitionVoiceTransport(live, serverError(error))

    expect(next.state).toEqual({ status: "closing", step: "handshake" })
    expect(next.effects).toEqual([
      { type: "stop.media" },
      { type: "close.handshake.start", ms: CLOSE_TIMEOUT },
      { type: "notify.dropped" },
    ])
  })
})

test("any error while connecting fails the join instead of dropping a call", () => {
  const next = transitionVoiceTransport(connecting, serverError({ type: "invalid_request_error", code: "x" }))

  expect(next.state).toEqual({ status: "closing", step: "releasing" })
  expect(next.effects).toContainEqual({ type: "join.reject", reason: "connection" })
  expect(types(next.effects)).not.toContain("notify.dropped")
})

test("a peer that recovers from disconnected keeps the call, and only its current grace timer can drop it", () => {
  const first = transitionVoiceTransport(live, peer("disconnected"))

  expect(first.effects).toEqual([{ type: "disconnect.timer.start", attempt: 1, ms: DISCONNECT_GRACE }])
  expect(transitionVoiceTransport(first.state, peer("disconnected")).state).toBe(first.state)

  const recovered = transitionVoiceTransport(first.state, peer("connected"))

  expect(recovered.state).toMatchObject({ status: "live" })
  expect(recovered.effects).toEqual([{ type: "disconnect.timer.clear" }])

  const second = transitionVoiceTransport(recovered.state, peer("disconnected"))

  expect(second.effects).toEqual([{ type: "disconnect.timer.start", attempt: 2, ms: DISCONNECT_GRACE }])
  expect(transitionVoiceTransport(second.state, { type: "disconnect.timeout", attempt: 1 }).state).toBe(second.state)

  const expired = transitionVoiceTransport(second.state, { type: "disconnect.timeout", attempt: 2 })

  expect(expired.state).toEqual({ status: "closing", step: "handshake" })
  expect(expired.effects).toEqual([
    { type: "stop.media" },
    { type: "close.handshake.start", ms: CLOSE_TIMEOUT },
    { type: "notify.dropped" },
  ])
})

test("a failed peer drops the call at once, even during the disconnect grace", () => {
  const grace = transitionVoiceTransport(live, peer("disconnected")).state
  const failed = transitionVoiceTransport(grace, peer("failed"))

  expect(failed.state).toEqual({ status: "closing", step: "releasing" })
  expect(failed.effects).toEqual([
    { type: "disconnect.timer.clear" },
    { type: "stop.media" },
    { type: "release.peer" },
    { type: "notify.dropped" },
  ])
})

test("a disconnect grace started while connecting carries into the live call", () => {
  const grace = transitionVoiceTransport(micStep, peer("disconnected")).state
  const joined = transitionVoiceTransport(grace, { type: "mic.ready" })

  expect(joined.state).toEqual({ status: "live", seq: 1, disconnectedAttempt: 1 })
  expect(transitionVoiceTransport(joined.state, { type: "disconnect.timeout", attempt: 1 }).effects).toContainEqual({
    type: "notify.dropped",
  })
})

test("failures during the join reject it with connect reasons and never report a dropped call", () => {
  const failures: [VoiceTransportState, VoiceTransportEvent, VoiceJoinFailure][] = [
    [connecting, { type: "channel.closed" }, "connection"],
    [connecting, peer("failed"), "connection"],
    [connecting, wire({ type: "session.closed" }), "connection"],
    [connecting, { type: "audio.play.failed" }, "connection"],
    [connecting, { type: "join.timeout" }, "connection"],
    [replay([join]).state, { type: "step.failed", step: "offer", reason: "unavailable" }, "unavailable"],
    [
      replay(handshake.slice(0, 2)).state,
      { type: "step.failed", step: "negotiating", reason: "connection" },
      "connection",
    ],
    [micStep, { type: "step.failed", step: "mic", reason: "microphone" }, "microphone"],
  ]

  failures.forEach(([state, event, reason]) => {
    const next = transitionVoiceTransport(state, event)

    expect(next.state).toMatchObject({ status: "closing" })
    expect(next.effects.at(-1)).toEqual({ type: "join.reject", reason })
    expect(next.effects[0]).toEqual({ type: "join.timer.clear" })
    expect(types(next.effects)).not.toContain("notify.dropped")
  })
})

test("a microphone failure after session.started still says goodbye to the session", () => {
  const next = transitionVoiceTransport(micStep, { type: "step.failed", step: "mic", reason: "microphone" })

  expect(next.state).toEqual({ status: "closing", step: "handshake" })
  expect(next.effects).toEqual([
    { type: "join.timer.clear" },
    { type: "stop.media" },
    { type: "close.handshake.start", ms: CLOSE_TIMEOUT },
    { type: "join.reject", reason: "microphone" },
  ])
})

test("End settles as soon as the channel or peer closes, without waiting for session.closed", () => {
  const ending = transitionVoiceTransport(live, { type: "close" })

  expect(ending.state).toEqual({ status: "closing", step: "handshake" })
  expect(ending.effects).toEqual([{ type: "stop.media" }, { type: "close.handshake.start", ms: CLOSE_TIMEOUT }])

  const closes: VoiceTransportEvent[] = [
    { type: "channel.closed" },
    peer("closed"),
    peer("failed"),
    wire({ type: "session.closed" }),
  ]

  closes.forEach((event) => {
    const next = transitionVoiceTransport(ending.state, event)

    expect(next.state).toEqual({ status: "closing", step: "releasing" })
    expect(next.effects).toEqual([{ type: "close.timer.clear" }, { type: "release.peer" }])
  })

  const timedOut = transitionVoiceTransport(ending.state, { type: "close.timeout" })

  expect(timedOut.effects).toEqual([{ type: "release.peer" }])

  const closed = transitionVoiceTransport(timedOut.state, { type: "peer.released" })

  expect(closed).toEqual({ state: { status: "closed" }, effects: [{ type: "close.resolve" }] })
})

test("a server that closed the session gets no session.close back", () => {
  const next = transitionVoiceTransport(live, wire({ type: "session.closed" }))

  expect(next.state).toEqual({ status: "closing", step: "releasing" })
  expect(next.effects).toEqual([{ type: "stop.media" }, { type: "release.peer" }, { type: "notify.dropped" }])
})

test("End before session.started releases at once instead of waiting on a session that never started", () => {
  const next = transitionVoiceTransport(connecting, { type: "close" })

  expect(next.state).toEqual({ status: "closing", step: "releasing" })
  expect(types(next.effects)).toEqual(["join.timer.clear", "stop.media", "release.peer", "join.reject"])

  const unjoined = transitionVoiceTransport(createVoiceTransportState(), { type: "close" })

  expect(unjoined.effects).toEqual([{ type: "stop.media" }, { type: "release.peer" }])
})

test("late events after the transport starts closing are ignored", () => {
  const late: VoiceTransportEvent[] = [
    { type: "close" },
    { type: "audio.play.failed" },
    { type: "track.received" },
    { type: "mic.ready" },
    { type: "join.timeout" },
    { type: "step.failed", step: "mic", reason: "microphone" },
    started,
    serverError({ type: "authentication_error" }),
  ]

  const states = [
    transitionVoiceTransport(live, { type: "close" }).state,
    transitionVoiceTransport(connecting, { type: "close" }).state,
    { status: "closed" } as const,
  ]

  states.forEach((state) =>
    late.forEach((event) => {
      const next = transitionVoiceTransport(state, event)

      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    }),
  )
})

test("the handshake waits for ICE when needed and accepts session.started before or after the answer", () => {
  const offering = replay([join]).state
  const gathering = transitionVoiceTransport(offering, { type: "offer.ready", iceComplete: false })

  expect(gathering.effects).toEqual([])
  expect(transitionVoiceTransport(gathering.state, { type: "ice.complete" }).effects).toEqual([
    { type: "negotiate", viewing: { id: "ses_1", title: "One" }, tail: "" },
  ])

  // session.started before the answer is applied.
  const early = replay([join, { type: "offer.ready", iceComplete: true }, started, started, { type: "answer.applied" }])

  expect(early.state).toMatchObject({ status: "connecting", step: { type: "mic" } })
  expect(types(early.effects).filter((type) => type === "acquire.mic")).toHaveLength(1)

  // session.started after the answer, then repeated.
  const late = replay([...handshake, started, started])

  expect(types(late.effects).filter((type) => type === "acquire.mic")).toHaveLength(1)
  expect(late.effects.slice(0, 2)).toEqual([{ type: "join.timer.start", ms: JOIN_TIMEOUT }, { type: "prepare.offer" }])
})

test("step results that arrive for another step are ignored", () => {
  const stale: [VoiceTransportState, VoiceTransportEvent][] = [
    [connecting, { type: "offer.ready", iceComplete: true }],
    [connecting, { type: "ice.complete" }],
    [connecting, { type: "answer.applied" }],
    [connecting, { type: "mic.ready" }],
    [connecting, { type: "step.failed", step: "offer", reason: "connection" }],
    [micStep, { type: "step.failed", step: "negotiating", reason: "connection" }],
    [connecting, join],
    [live, join],
    [live, { type: "mic.ready" }],
  ]

  stale.forEach(([state, event]) => expect(transitionVoiceTransport(state, event)).toEqual({ state, effects: [] }))
})
