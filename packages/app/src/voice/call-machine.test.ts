import { expect, test } from "bun:test"
import type { ServerConnection } from "@/runtime/server/registry"
import {
  CONNECT_TIMEOUT,
  createVoiceCallState,
  END_TIMEOUT,
  MAX_CAPTIONS,
  transitionVoiceCall,
  voiceCallView,
  type VoiceCallEffect,
  type VoiceCallEvent,
  type VoiceCallState,
} from "./call-machine"

// SAFETY: the machine only compares server keys for equality; any distinct strings stand in for real ones.
const [server, other] = ["local", "remote"] as [ServerConnection.Key, ServerConnection.Key]

const ctx = { name: "ctx" }

const here = { id: "ses_here", title: "Here" }

const there = { id: "ses_there", title: "There" }

type Ctx = typeof ctx

function replay(events: VoiceCallEvent<Ctx>[], start: VoiceCallState<Ctx> = createVoiceCallState<Ctx>()) {
  return events.reduce(
    (result: { state: VoiceCallState<Ctx>; effects: VoiceCallEffect<Ctx>[] }, event) => {
      const next = transitionVoiceCall(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: start, effects: [] },
  )
}

const start: VoiceCallEvent<Ctx> = { type: "start", server, ctx, session: here }

const joined = (attempt = 1): VoiceCallEvent<Ctx> => ({ type: "connect.succeeded", attempt })

const dropped = (attempt = 1, failure: "dropped" | "connection" = "dropped"): VoiceCallEvent<Ctx> => ({
  type: "call.dropped",
  attempt,
  failure,
})

const connected = replay([start, joined()]).state

test("a transport failure during join keeps its reason when the aborted join rejects", () => {
  // The transport fails mid-join, then closing it rejects the join with "connection".
  const result = replay([start, dropped(1), { type: "connect.failed", attempt: 1, failure: "connection" }])

  expect(result.state).toMatchObject({ status: "dropped", failure: "dropped", attempt: 1 })
  expect(result.effects.filter((effect) => effect.type === "disconnect")).toEqual([{ type: "disconnect", attempt: 1 }])
})

test("only the first of several drops of one attempt closes the call", () => {
  const first = transitionVoiceCall(connected, dropped(1, "dropped"))

  expect(first.effects).toEqual([{ type: "disconnect", attempt: 1 }])
  // Instructions, outputs and mute sends all fail once the channel is closed.
  const again = transitionVoiceCall(first.state, dropped(1, "connection"))

  expect(again.state).toBe(first.state)
  expect(again.effects).toEqual([])
  expect(voiceCallView(first.state).failure).toBe("dropped")
})

test("End hides the call at once and Call waits until the previous call is released", () => {
  const ending = transitionVoiceCall(connected, { type: "end" })

  expect(ending.state).toEqual({ status: "ending", attempt: 2 })
  expect(ending.effects).toEqual([{ type: "teardown", attempt: 2, timeout: END_TIMEOUT }])
  expect(voiceCallView(ending.state)).toMatchObject({
    panelOpen: false,
    canMute: false,
    canRejoin: false,
    canStart: false,
  })
  // A second End and an early Call both land while the first teardown still runs.
  expect(transitionVoiceCall(ending.state, { type: "end" }).state).toBe(ending.state)
  expect(transitionVoiceCall(ending.state, start).state).toBe(ending.state)

  const settled = transitionVoiceCall(ending.state, { type: "end.settled", attempt: 2 })

  expect(settled.state).toEqual({ status: "idle", attempt: 2 })
  expect(voiceCallView(settled.state)).toMatchObject({ canStart: true, failure: undefined, captions: [] })
  expect(transitionVoiceCall(settled.state, { type: "end.timeout", attempt: 2 }).state).toBe(settled.state)
})

test("a teardown that hangs still offers Call again", () => {
  const ending = replay([{ type: "end" }], connected).state

  expect(transitionVoiceCall(ending, { type: "end.timeout", attempt: 2 }).state).toEqual({ status: "idle", attempt: 2 })
})

test("Rejoin after a failed first connect retries with the call's server and context", () => {
  // A failed module load reports "connection" before any session exists.
  const failed = replay([start, { type: "connect.failed", attempt: 1, failure: "connection" }]).state

  expect(voiceCallView(failed)).toMatchObject({ canRejoin: true, failure: "connection" })

  const rejoined = transitionVoiceCall(failed, { type: "rejoin" })

  expect(rejoined.state).toMatchObject({ status: "connecting", attempt: 2 })
  expect(rejoined.effects).toEqual([
    { type: "connect", attempt: 2, server, ctx, viewing: here, muted: false, timeout: CONNECT_TIMEOUT },
  ])
})

test("navigation while connecting reaches the backend once, and repeated views send nothing", () => {
  const moved = replay([start, { type: "session.viewed", server, session: there }])

  expect(voiceCallView(moved.state).title).toBe("There")
  expect(transitionVoiceCall(moved.state, joined()).effects).toEqual([{ type: "activate", attempt: 1, sync: there }])
  expect(transitionVoiceCall(replay([start]).state, joined()).effects).toEqual([{ type: "activate", attempt: 1 }])

  // The composer reports its session on every store update; only a real change updates instructions.
  const same = transitionVoiceCall(connected, { type: "session.viewed", server, session: { ...here } })

  expect(same.state).toBe(connected)
  expect(same.effects).toEqual([])
  expect(transitionVoiceCall(connected, { type: "session.viewed", server: other, session: there }).state).toBe(
    connected,
  )
  expect(transitionVoiceCall(connected, { type: "session.viewed", server, session: there }).effects).toEqual([
    { type: "instructions", attempt: 1, viewing: there },
  ])
})

test("Mute only applies to a live call, and a muted Rejoin stays muted", () => {
  expect(transitionVoiceCall(replay([start]).state, { type: "mute.toggled" }).effects).toEqual([])

  const muted = transitionVoiceCall(connected, { type: "mute.toggled" })

  expect(muted.effects).toEqual([{ type: "mute", attempt: 1, muted: true }])
  // The mute send fails on a closed channel; the call drops instead of throwing out of the click.
  const rejoined = replay([dropped(1), { type: "rejoin" }], muted.state)

  expect(rejoined.effects.at(-1)).toMatchObject({ type: "connect", attempt: 2, muted: true })
  expect(transitionVoiceCall(rejoined.state, { type: "mute.toggled" }).state).toBe(rejoined.state)
})

test("results from an earlier attempt are ignored", () => {
  const rejoining = replay([start, dropped(1), { type: "rejoin" }]).state

  expect(rejoining).toMatchObject({ status: "connecting", attempt: 2 })

  const stale: VoiceCallEvent<Ctx>[] = [
    joined(1),
    { type: "connect.failed", attempt: 1, failure: "microphone" },
    { type: "connect.timeout", attempt: 1 },
    dropped(1),
    { type: "level.updated", attempt: 1, mic: 1, speaker: 1 },
    { type: "caption.updated", attempt: 1, utterance: 0, speaker: "user", text: "late" },
    { type: "end.settled", attempt: 1 },
    { type: "end.timeout", attempt: 1 },
  ]

  stale.forEach((event) => expect(transitionVoiceCall(rejoining, event).state).toBe(rejoining))
})

test("a join that never finishes drops with a connection failure", () => {
  const result = replay([start, { type: "connect.timeout", attempt: 1 }])

  expect(result.state).toMatchObject({ status: "dropped", failure: "connection" })
  expect(result.effects.at(-1)).toEqual({ type: "disconnect", attempt: 1 })
  expect(transitionVoiceCall(connected, { type: "connect.timeout", attempt: 1 }).state).toBe(connected)
})

test("disposal tears down every open phase", () => {
  const phases = [replay([start]).state, connected, replay([dropped(1)], connected).state]

  phases.forEach((state) =>
    expect(transitionVoiceCall(state, { type: "disposed" })).toEqual({
      state: { status: "idle", attempt: 2 },
      effects: [{ type: "teardown", attempt: 2, timeout: END_TIMEOUT }],
    }),
  )
  const ending = replay([{ type: "end" }], connected).state

  expect(transitionVoiceCall(ending, { type: "disposed" })).toEqual({
    state: { status: "idle", attempt: 3 },
    effects: [],
  })
  const idle = createVoiceCallState<Ctx>()

  expect(transitionVoiceCall(idle, { type: "disposed" }).state).toBe(idle)
})

test("levels after a drop never reach the meter, and an unchanged level writes nothing", () => {
  const level = transitionVoiceCall(connected, { type: "level.updated", attempt: 1, mic: 0.1, speaker: 0.02 })

  expect(voiceCallView(level.state).level).toBe(0.5)
  expect(transitionVoiceCall(level.state, { type: "level.updated", attempt: 1, mic: 0.1, speaker: 0.02 }).state).toBe(
    level.state,
  )

  const muted = replay(
    [{ type: "mute.toggled" }, { type: "level.updated", attempt: 1, mic: 0.1, speaker: 0.02 }],
    connected,
  )

  expect(voiceCallView(muted.state).level).toBe(0.1)
  // The transport's 100 ms level timer can tick once more after it drops.
  const drop = transitionVoiceCall(level.state, dropped(1)).state

  expect(transitionVoiceCall(drop, { type: "level.updated", attempt: 1, mic: 1, speaker: 1 }).state).toBe(drop)
  expect(voiceCallView(drop).level).toBe(0)
})

test("captions grow per utterance, keep the last four, survive Rejoin and clear on End", () => {
  const caption = (utterance: number, text: string): VoiceCallEvent<Ctx> => ({
    type: "caption.updated",
    attempt: 1,
    utterance,
    speaker: utterance % 2 ? "assistant" : "user",
    text,
  })

  const grown = replay([caption(0, "Please"), caption(0, "Please fix"), caption(1, "On it")], connected).state

  expect(voiceCallView(grown).captions).toEqual([
    { utterance: 0, speaker: "user", text: "Please fix" },
    { utterance: 1, speaker: "assistant", text: "On it" },
  ])
  expect(voiceCallView(grown).latestCaption).toEqual({ utterance: 1, speaker: "assistant", text: "On it" })
  expect(transitionVoiceCall(grown, caption(1, "On it")).state).toBe(grown)
  expect(transitionVoiceCall(grown, caption(2, "")).state).toBe(grown)

  const many = replay(
    [2, 3, 4, 5].map((utterance) => caption(utterance, `line ${utterance}`)),
    grown,
  ).state

  expect(voiceCallView(many).captions.map((item) => item.utterance)).toEqual([2, 3, 4, 5])
  expect(voiceCallView(many).captions).toHaveLength(MAX_CAPTIONS)

  const rejoined = replay([dropped(1), { type: "rejoin" }], many).state

  expect(voiceCallView(rejoined).captions).toBe(voiceCallView(many).captions)
  const ended = replay([{ type: "end" }, { type: "end.settled", attempt: 3 }], rejoined).state

  expect(voiceCallView(ended).captions).toEqual([])
})
