import { describe, expect, test } from "bun:test"
import {
  createSessionHandoffState,
  HANDOFF_ECHO_TIMEOUT_MS,
  HANDOFF_SEND_TIMEOUT_MS,
  HANDOFF_SYNC_TIMEOUT_MS,
  selectSessionHandoff,
  transitionSessionHandoff,
  type SessionHandoffEvent,
  type SessionHandoffState,
  type SessionHandoffTransition,
  type SessionMessageHandoff,
} from "./handoff-machine"

const handoff = (id: string): SessionMessageHandoff => ({
  message: { id, type: "user", text: id, time: { created: 1 } },
  selection: { agent: "build", model: { id: "model", providerID: "provider" } },
})

const set = (id: string, sessionID = "ses_1"): SessionHandoffEvent => ({
  type: "handoff.set",
  sessionID,
  handoff: handoff(id),
})

function replay(events: SessionHandoffEvent[], from = createSessionHandoffState()) {
  return events.reduce<SessionHandoffTransition[]>((steps, event) => {
    steps.push(transitionSessionHandoff(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

const last = (steps: SessionHandoffTransition[]) => steps.at(-1)!

const held = (state: SessionHandoffState, sessionID = "ses_1") =>
  state.status === "active" ? state.entries[sessionID] : undefined

describe("transitionSessionHandoff", () => {
  test("a settled send whose echo never arrives syncs, then ends", () => {
    const steps = replay([
      set("msg_1"),
      { type: "prompt.settled", sessionID: "ses_1", messageID: "msg_1" },
      { type: "echo.timed-out", sessionID: "ses_1", attempt: 2 },
      { type: "sync.settled", sessionID: "ses_1", attempt: 3 },
    ])

    expect(steps.map((step) => held(step.state)?.phase)).toEqual(["sending", "awaiting-echo", "syncing", undefined])
    expect(steps[1].effects).toEqual([
      { type: "timer.set", sessionID: "ses_1", timer: "echo", attempt: 2, delayMs: HANDOFF_ECHO_TIMEOUT_MS },
    ])
    expect(steps[2].effects).toEqual([
      { type: "sync", sessionID: "ses_1", attempt: 3 },
      { type: "timer.set", sessionID: "ses_1", timer: "sync", attempt: 3, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
    ])
    expect(steps[3].effects).toEqual([{ type: "timer.cancel", sessionID: "ses_1" }])
  })

  test("a send that settles while the stream is down waits for the reconnect, then syncs at once", () => {
    const steps = replay([
      set("msg_1"),
      { type: "connection.changed", connected: false },
      { type: "prompt.settled", sessionID: "ses_1", messageID: "msg_1" },
      { type: "connection.changed", connected: true },
      { type: "sync.settled", sessionID: "ses_1", attempt: 2 },
    ])

    expect(steps[2].effects).toEqual([
      { type: "timer.set", sessionID: "ses_1", timer: "echo", attempt: 2, delayMs: HANDOFF_SEND_TIMEOUT_MS },
    ])
    expect(held(steps[3].state)?.phase).toBe("syncing")
    expect(steps[3].effects).toEqual([
      { type: "sync", sessionID: "ses_1", attempt: 2 },
      { type: "timer.set", sessionID: "ses_1", timer: "sync", attempt: 2, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
    ])
    expect(held(last(steps).state)).toBeUndefined()
  })

  test("a stream that drops while an echo is due extends the wait, and a stream that stays down ends it", () => {
    const steps = replay([
      set("msg_1"),
      { type: "prompt.settled", sessionID: "ses_1", messageID: "msg_1" },
      { type: "connection.changed", connected: false },
      { type: "echo.timed-out", sessionID: "ses_1", attempt: 2 },
    ])

    expect(steps[2].effects).toEqual([
      { type: "timer.set", sessionID: "ses_1", timer: "echo", attempt: 2, delayMs: HANDOFF_SEND_TIMEOUT_MS },
    ])
    expect(held(last(steps).state)).toBeUndefined()
    expect(last(steps).effects).toEqual([])
  })

  test("a connection change without a due echo writes only the connection", () => {
    const sending = transitionSessionHandoff(createSessionHandoffState(), set("msg_1")).state
    const result = transitionSessionHandoff(sending, { type: "connection.changed", connected: false })

    expect(result.effects).toEqual([])
    expect(result.state).toMatchObject({ connected: false })
    expect(held(result.state)).toBe(held(sending))
    expect(transitionSessionHandoff(sending, { type: "connection.changed", connected: true }).state).toBe(sending)
  })

  test.each<[string, SessionHandoffEvent]>([
    ["its echo", { type: "handoff.cleared", sessionID: "ses_1", messageID: "msg_1" }],
    ["a revert at the prompt", { type: "session.reverted", sessionID: "ses_1", boundary: "msg_1" }],
    ["a revert before the prompt", { type: "session.reverted", sessionID: "ses_1", boundary: "msg_0" }],
    ["the session's deletion", { type: "session.deleted", sessionID: "ses_1" }],
  ])("%s ends a handoff in every phase", (_, event) => {
    const phases = [
      [set("msg_1")],
      [set("msg_1"), { type: "prompt.settled", sessionID: "ses_1", messageID: "msg_1" }],
      [
        set("msg_1"),
        { type: "prompt.settled", sessionID: "ses_1", messageID: "msg_1" },
        { type: "echo.timed-out", sessionID: "ses_1", attempt: 2 },
      ],
    ] satisfies SessionHandoffEvent[][]

    phases.forEach((events) => {
      const result = last(replay([...events, event]))

      expect(held(result.state)).toBeUndefined()
      expect(result.effects).toEqual([{ type: "timer.cancel", sessionID: "ses_1" }])
    })
  })

  test("a revert after the prompt, or another prompt's echo, leaves the handoff", () => {
    const state = transitionSessionHandoff(createSessionHandoffState(), set("msg_1")).state

    expect(
      transitionSessionHandoff(state, { type: "session.reverted", sessionID: "ses_1", boundary: "msg_2" }),
    ).toEqual({
      state,
      effects: [],
    })
    expect(
      transitionSessionHandoff(state, { type: "handoff.cleared", sessionID: "ses_1", messageID: "msg_0" }).state,
    ).toBe(state)
    expect(transitionSessionHandoff(state, { type: "session.deleted", sessionID: "ses_2" }).state).toBe(state)
  })

  test("a newer prompt replaces the handoff, and the older one's results change nothing", () => {
    const state = last(replay([set("msg_1"), set("msg_2")])).state

    expect(selectSessionHandoff(state, "ses_1")?.message.id).toBe("msg_2")

    const late: SessionHandoffEvent[] = [
      { type: "handoff.cleared", sessionID: "ses_1", messageID: "msg_1" },
      { type: "prompt.settled", sessionID: "ses_1", messageID: "msg_1" },
      { type: "sending.timed-out", sessionID: "ses_1", attempt: 1 },
    ]

    late.forEach((event) => expect(transitionSessionHandoff(state, event).state).toBe(state))
  })

  test("a prompt set again after its session cleared gets a new attempt", () => {
    const steps = replay([
      set("msg_1"),
      { type: "sending.timed-out", sessionID: "ses_1", attempt: 1 },
      { type: "handoff.cleared", sessionID: "ses_1", messageID: "msg_1" },
      set("msg_2"),
    ])

    const state = last(steps).state

    expect(held(state)?.attempt).toBe(3)
    expect(transitionSessionHandoff(state, { type: "sync.settled", sessionID: "ses_1", attempt: 2 }).state).toBe(state)
  })

  test("a send that hangs syncs when connected and ends when not; a sync that hangs ends", () => {
    const connected = replay([set("msg_1"), { type: "sending.timed-out", sessionID: "ses_1", attempt: 1 }])

    expect(held(last(connected).state)?.phase).toBe("syncing")
    expect(last(connected).effects).toEqual([
      { type: "sync", sessionID: "ses_1", attempt: 2 },
      { type: "timer.set", sessionID: "ses_1", timer: "sync", attempt: 2, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
    ])
    expect(
      held(
        transitionSessionHandoff(last(connected).state, { type: "sync.timed-out", sessionID: "ses_1", attempt: 2 })
          .state,
      ),
    ).toBeUndefined()

    const offline = last(
      replay(
        [set("msg_1"), { type: "sending.timed-out", sessionID: "ses_1", attempt: 1 }],
        createSessionHandoffState(false),
      ),
    )

    expect(held(offline.state)).toBeUndefined()
    expect(offline.effects).toEqual([])
  })

  test("a timeout or sync result for another phase changes nothing", () => {
    const sending = transitionSessionHandoff(createSessionHandoffState(), set("msg_1")).state

    const events: SessionHandoffEvent[] = [
      { type: "echo.timed-out", sessionID: "ses_1", attempt: 1 },
      { type: "sync.settled", sessionID: "ses_1", attempt: 1 },
      { type: "sync.timed-out", sessionID: "ses_1", attempt: 1 },
      { type: "prompt.settled", sessionID: "ses_2", messageID: "msg_1" },
    ]

    events.forEach((event) => expect(transitionSessionHandoff(sending, event).state).toBe(sending))
  })

  test("disposal cancels every timer and ignores later results", () => {
    const disposed = last(replay([set("msg_1"), set("msg_2", "ses_2"), { type: "disposed" }]))

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "timer.cancel-all" }] })
    expect(transitionSessionHandoff(disposed.state, set("msg_3")).state).toBe(disposed.state)
    expect(selectSessionHandoff(disposed.state, "ses_1")).toBeUndefined()
    expect(transitionSessionHandoff(createSessionHandoffState(), { type: "disposed" }).effects).toEqual([])
  })

  test("each session holds its own handoff", () => {
    const state = last(
      replay([set("msg_1"), set("msg_2", "ses_2"), { type: "session.deleted", sessionID: "ses_2" }]),
    ).state

    expect(selectSessionHandoff(state, "ses_1")?.message.id).toBe("msg_1")
    expect(selectSessionHandoff(state, "ses_2")).toBeUndefined()
    expect(selectSessionHandoff(state, undefined)).toBeUndefined()
  })
})
