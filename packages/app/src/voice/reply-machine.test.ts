import { expect, test } from "bun:test"
import type { VoiceReply } from "./replies"
import {
  createVoiceReplyState,
  FETCH_TIMEOUT,
  MAX_RETRIES,
  replyCommentary,
  transitionVoiceReply,
  type VoiceReplyEffect,
  type VoiceReplyEvent,
  type VoiceReplyState,
} from "./reply-machine"

function replay(events: VoiceReplyEvent[], start: VoiceReplyState = connected) {
  return events.reduce(
    (result: { state: VoiceReplyState; effects: VoiceReplyEffect[] }, event) => {
      const next = transitionVoiceReply(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: start, effects: [] },
  )
}

const connected = transitionVoiceReply(createVoiceReplyState(), { type: "call.connected", sessionIDs: [] }).state

const reply = (sessionID: string, messageID: string): VoiceReply => ({
  sessionID,
  promptID: `prompt_${messageID}`,
  title: "Session",
  instruction: "Fix it",
  messageID,
  text: `Reply ${messageID}`,
})

const dirty = (...sessionIDs: string[]): VoiceReplyEvent => ({ type: "sessions.dirty", sessionIDs })

const fetched = (state: VoiceReplyState, replies: VoiceReply[] = []): VoiceReplyEvent => {
  if (state.status !== "fetching") throw new Error(`expected fetching, got ${state.status}`)

  return { type: "fetch.succeeded", attempt: state.attempt, sessionID: state.sessionID, replies }
}

const failed = (state: VoiceReplyState): VoiceReplyEvent => {
  if (state.status !== "fetching") throw new Error(`expected fetching, got ${state.status}`)

  return { type: "fetch.failed", attempt: state.attempt, sessionID: state.sessionID }
}

const opened = (state: VoiceReplyState): VoiceReplyEvent => ({ type: "gate.opened", attempt: state.attempt })

const announced = (state: VoiceReplyState, item: VoiceReply): VoiceReplyEvent => ({
  type: "announce.succeeded",
  attempt: state.attempt,
  reply: item,
})

const fetches = (effects: VoiceReplyEffect[]) => effects.filter((effect) => effect.type === "fetch")

test("replies held by the speech gates are announced in order without reading history again", () => {
  const first = reply("ses_1", "msg_1")
  const second = reply("ses_1", "msg_2")
  const reading = transitionVoiceReply(connected, dirty("ses_1"))

  expect(reading.effects).toEqual([{ type: "fetch", attempt: 1, sessionID: "ses_1", timeout: FETCH_TIMEOUT }])

  const held = transitionVoiceReply(reading.state, fetched(reading.state, [first, second]))

  expect(held.state.status).toBe("holding")
  expect(held.effects).toEqual([{ type: "hold", attempt: 2 }])

  const speaking = transitionVoiceReply(held.state, opened(held.state))

  expect(speaking.effects).toEqual([{ type: "announce", attempt: 2, reply: first }])

  // Announcing the first answer arms the gates again; the second waits for them, not for another read.
  const next = transitionVoiceReply(speaking.state, announced(speaking.state, first))

  expect(next.effects).toEqual([{ type: "hold", attempt: 3 }])
  const last = replay([opened(next.state)], next.state)

  expect(last.effects).toEqual([{ type: "announce", attempt: 3, reply: second }])
  const done = replay([announced(last.state, second)], last.state)

  expect(done.state).toMatchObject({ status: "idle", announcements: [] })
  expect(fetches([...held.effects, ...speaking.effects, ...next.effects, ...last.effects, ...done.effects])).toEqual([])
})

test("a failing session backs off alone, with a cap, while healthy sessions are read at once", () => {
  const ok = reply("ses_ok", "msg_ok")
  const reading = transitionVoiceReply(connected, dirty("ses_bad", "ses_ok")).state

  expect(reading).toMatchObject({ status: "fetching", sessionID: "ses_bad" })
  const healthy = transitionVoiceReply(reading, failed(reading))

  expect(healthy.effects).toEqual([{ type: "fetch", attempt: 2, sessionID: "ses_ok", timeout: FETCH_TIMEOUT }])
  const announcing = replay([fetched(healthy.state, [ok])], healthy.state).state
  const speaking = transitionVoiceReply(announcing, opened(announcing)).state
  const waiting = transitionVoiceReply(speaking, announced(speaking, ok))

  expect(waiting.effects).toEqual([{ type: "retry", attempt: 4, ms: 1000 }])

  const delays = [2000, 4000, 8000].reduce(
    (result: { state: VoiceReplyState; delays: number[] }, expected) => {
      const retried = transitionVoiceReply(result.state, { type: "retry.due", attempt: result.state.attempt })

      expect(retried.effects).toEqual([
        { type: "fetch", attempt: result.state.attempt + 1, sessionID: "ses_bad", timeout: FETCH_TIMEOUT },
      ])
      const next = transitionVoiceReply(retried.state, failed(retried.state))
      const retry = next.effects.find((effect) => effect.type === "retry")

      expect(retry?.ms).toBe(expected)

      return { state: next.state, delays: [...result.delays, retry?.ms ?? 0] }
    },
    { state: waiting.state, delays: [] },
  )

  expect(delays.delays).toEqual([2000, 4000, 8000])
  const final = transitionVoiceReply(delays.state, { type: "retry.due", attempt: delays.state.attempt }).state
  const stopped = transitionVoiceReply(final, failed(final))

  expect(stopped.state).toMatchObject({ status: "idle", retry: [], failures: { ses_bad: MAX_RETRIES + 1 } })
  expect(stopped.effects).toEqual([])
  // Its next idle event reads it again from a clean slate.
  expect(transitionVoiceReply(stopped.state, dirty("ses_bad")).state).toMatchObject({
    status: "fetching",
    sessionID: "ses_bad",
    failures: {},
  })
})

test("a drop mid-read ignores the late result and reads again on Rejoin", () => {
  const reading = transitionVoiceReply(connected, dirty("ses_1")).state
  const dropped = transitionVoiceReply(reading, { type: "call.disconnected" })

  expect(dropped.effects).toEqual([{ type: "fetch.abort" }])
  expect(dropped.state).toMatchObject({ status: "idle", connected: false, sessions: ["ses_1"] })
  expect(transitionVoiceReply(dropped.state, fetched(reading, [reply("ses_1", "msg_1")])).state).toBe(dropped.state)

  const rejoined = transitionVoiceReply(dropped.state, { type: "call.connected", sessionIDs: ["ses_1"] })

  expect(fetches(rejoined.effects)).toEqual([
    { type: "fetch", attempt: dropped.state.attempt + 1, sessionID: "ses_1", timeout: FETCH_TIMEOUT },
  ])
})

test("a reply whose commentary failed to send is announced after Rejoin without a new read", () => {
  const item = reply("ses_1", "msg_1")
  const holding = replay([dirty("ses_1")]).state
  const speaking = replay([fetched(holding, [item])], holding).state
  const announcing = transitionVoiceReply(speaking, opened(speaking)).state

  expect(announcing.status).toBe("announcing")
  // The send threw, so no announce.succeeded follows; the call drops.
  const dropped = transitionVoiceReply(announcing, { type: "call.disconnected" })

  expect(dropped.effects).toEqual([])
  const rejoined = transitionVoiceReply(dropped.state, { type: "call.connected", sessionIDs: ["ses_1"] })

  expect(rejoined.effects).toEqual([{ type: "hold", attempt: dropped.state.attempt + 1 }])
  expect(rejoined.state.announcements).toEqual([item])
})

test("a reply sent just before a drop is never announced again", () => {
  const item = reply("ses_1", "msg_1")
  const holding = replay([dirty("ses_1")]).state
  const speaking = replay([fetched(holding, [item])], holding).state
  const announcing = transitionVoiceReply(speaking, opened(speaking)).state
  const dropped = transitionVoiceReply(announcing, { type: "call.disconnected" }).state
  const late = transitionVoiceReply(dropped, announced(announcing, item))

  expect(late.state.announcements).toEqual([])
  expect(late.effects).toEqual([])
})

test("delegations pause reads and waits, and resume them when they end", () => {
  const reading = transitionVoiceReply(connected, dirty("ses_1")).state
  const paused = transitionVoiceReply(reading, { type: "delegations.changed", delegating: true })

  expect(paused.effects).toEqual([{ type: "fetch.abort" }])
  expect(paused.state).toMatchObject({ status: "idle", sessions: ["ses_1"] })
  expect(transitionVoiceReply(paused.state, dirty("ses_2")).effects).toEqual([])

  const resumed = transitionVoiceReply(paused.state, { type: "delegations.changed", delegating: false })

  expect(fetches(resumed.effects)).toEqual([
    { type: "fetch", attempt: paused.state.attempt + 1, sessionID: "ses_1", timeout: FETCH_TIMEOUT },
  ])

  const holding = replay([fetched(resumed.state, [reply("ses_1", "msg_1")])], resumed.state).state

  expect(transitionVoiceReply(holding, { type: "delegations.changed", delegating: true }).effects).toEqual([
    { type: "wait.clear" },
  ])
  const announcing = transitionVoiceReply(holding, opened(holding)).state

  // The commentary is already on its way; the delegation waits for its result.
  expect(transitionVoiceReply(announcing, { type: "delegations.changed", delegating: true })).toEqual({
    state: { ...announcing, delegating: true },
    effects: [],
  })
})

test("a reply a delegation already read aloud is not announced", () => {
  const first = reply("ses_1", "msg_1")
  const second = reply("ses_1", "msg_2")
  const reading = transitionVoiceReply(connected, dirty("ses_1")).state
  const holding = transitionVoiceReply(reading, fetched(reading, [first, second])).state

  const one = transitionVoiceReply(holding, {
    type: "replies.heard",
    heard: [{ sessionID: "ses_1", messageID: "msg_1" }],
  })

  expect(one.state.announcements).toEqual([second])
  expect(one.effects).toEqual([])

  const none = transitionVoiceReply(one.state, {
    type: "replies.heard",
    heard: [{ sessionID: "ses_1", messageID: "msg_2" }],
  })

  expect(none.state).toMatchObject({ status: "idle", announcements: [] })
  expect(none.effects).toEqual([{ type: "wait.clear" }])
  expect(transitionVoiceReply(none.state, { type: "replies.heard", heard: [] }).state).toBe(none.state)
})

test("an idle event during a read of the same session reads it once more afterwards", () => {
  const reading = transitionVoiceReply(connected, dirty("ses_1")).state
  const again = transitionVoiceReply(reading, dirty("ses_1"))

  expect(again.effects).toEqual([])
  expect(again.state).toMatchObject({ status: "fetching", sessions: ["ses_1"] })
  expect(transitionVoiceReply(again.state, dirty("ses_1")).state).toBe(again.state)
  expect(fetches(transitionVoiceReply(again.state, fetched(again.state)).effects)).toEqual([
    { type: "fetch", attempt: again.state.attempt + 1, sessionID: "ses_1", timeout: FETCH_TIMEOUT },
  ])
})

test("a healthy idle event cuts a backoff short", () => {
  const reading = transitionVoiceReply(connected, dirty("ses_bad")).state
  const waiting = transitionVoiceReply(reading, failed(reading)).state

  expect(waiting.status).toBe("backoff")
  const healthy = transitionVoiceReply(waiting, dirty("ses_ok"))

  expect(healthy.effects).toEqual([
    { type: "wait.clear" },
    { type: "fetch", attempt: waiting.attempt + 1, sessionID: "ses_ok", timeout: FETCH_TIMEOUT },
  ])
  expect(healthy.state.retry).toEqual(["ses_bad"])
})

test("late timers and reads from an earlier step are ignored", () => {
  const reading = transitionVoiceReply(connected, dirty("ses_1")).state
  const holding = transitionVoiceReply(reading, fetched(reading, [reply("ses_1", "msg_1")])).state

  const stale: VoiceReplyEvent[] = [
    { type: "gate.opened", attempt: reading.attempt },
    { type: "retry.due", attempt: holding.attempt },
    { type: "fetch.failed", attempt: reading.attempt, sessionID: "ses_1" },
    { type: "announce.succeeded", attempt: holding.attempt, reply: reply("ses_1", "msg_other") },
  ]

  stale.forEach((event) => expect(transitionVoiceReply(holding, event).state).toBe(holding))
})

test("disposal cancels whatever step is running", () => {
  const reading = transitionVoiceReply(connected, dirty("ses_1")).state
  const holding = transitionVoiceReply(reading, fetched(reading, [reply("ses_1", "msg_1")])).state

  expect(transitionVoiceReply(reading, { type: "disposed" }).effects).toEqual([{ type: "fetch.abort" }])
  expect(transitionVoiceReply(holding, { type: "disposed" })).toEqual({
    state: createVoiceReplyState(holding.attempt + 1),
    effects: [{ type: "wait.clear" }],
  })
})

test("commentary keeps code out of speech and stays bounded", () => {
  const text = replyCommentary({
    ...reply("ses_1", "msg_1"),
    text: `Done.\n\`\`\`ts\nconst x = 1\n\`\`\`\n${"a".repeat(900)}`,
  })

  expect(text.startsWith('Result from session "Session", request "Fix it": Done.\n[code in session]')).toBe(true)
  expect(text).not.toContain("const x")
  expect(text.length).toBeLessThan(900)
})
