import { expect, test } from "bun:test"
import {
  createComposerFocusState,
  FOCUS_HANDOFF_TIMEOUT_MS,
  needsRealComposerFocus,
  REAL_FOCUS_RETRY_LIMIT,
  transitionComposerFocus,
  type ComposerFocusEffect,
  type ComposerFocusEvent,
  type ComposerFocusState,
} from "./focus-machine"

const A = "ses_a"

const B = "ses_b"

// A frame or timer result answers the state it was started from, the way the driver fences them by attempt.
type Answer = { readonly answer: (state: ComposerFocusState) => ComposerFocusEvent }

type Step = ComposerFocusEvent | Answer

type Replay = {
  readonly state: ComposerFocusState
  readonly effects: readonly ComposerFocusEffect[]
  readonly log: readonly ComposerFocusEffect[]
}

function replay(steps: Step[], initial = createComposerFocusState()) {
  const start: Replay = { state: initial, effects: [], log: [] }

  return steps.reduce<Replay>((current, step) => {
    const result = transitionComposerFocus(current.state, "answer" in step ? step.answer(current.state) : step)

    return { state: result.state, effects: result.effects, log: [...current.log, ...result.effects] }
  }, start)
}

const attempt = (state: ComposerFocusState) => (state.status === "disposed" ? -1 : state.attempt)

const preparingFrame = (outcome: "focused" | "blocked"): Answer => ({
  answer: (state) => ({ type: "preparing.frame", attempt: attempt(state), outcome }),
})

const realFrame = (outcome: "focused" | "claimed" | "blocked"): Answer => ({
  answer: (state) => ({ type: "real.frame", attempt: attempt(state), outcome }),
})

const timeout: Answer = { answer: (state) => ({ type: "timeout", attempt: attempt(state) }) }

// The user typed in the pending session's composer, which took focus on its first frame.
const typing: Step[] = [
  { type: "target.changed", target: A },
  { type: "preparing.mounted", target: A, cursor: 0 },
  preparingFrame("focused"),
]

test("a session composer that mounts frames after the pending composer left takes its focus and caret", () => {
  const handoff = replay([...typing, { type: "preparing.unmounted", target: A, cursor: 32 }])
  expect(handoff.state).toMatchObject({ status: "handoff", target: A, cursor: 32 })
  expect(handoff.effects).toEqual([])

  // The route resolves the session and the request dock clears before the composer can take focus.
  const mounted = replay([{ type: "real.mounted", target: A }], handoff.state)
  expect(mounted.state).toMatchObject({ status: "pending-real", cursor: 32, retries: 0 })
  expect(mounted.effects).toEqual([
    { type: "timer.start", attempt: attempt(mounted.state), delayMs: FOCUS_HANDOFF_TIMEOUT_MS },
  ])
  expect(needsRealComposerFocus(mounted.state, A)).toBe(true)

  // The caret read from the pending editor wins over the stored cursor, which can lag behind it.
  const ready = replay([{ type: "real.ready", target: A, cursor: 31 }], mounted.state)
  expect(ready.effects).toEqual([
    { type: "timer.clear" },
    { type: "frame.real", target: A, attempt: attempt(ready.state), cursor: 32 },
  ])

  const done = replay([realFrame("focused")], ready.state)
  expect(done.state).toMatchObject({ status: "idle", target: A })
  expect(needsRealComposerFocus(done.state, A)).toBe(false)
})

test("a session created before the pending composer's first frame still hands focus over", () => {
  const claiming = replay([
    { type: "target.changed", target: A },
    { type: "preparing.mounted", target: A, cursor: 4 },
  ])

  expect(claiming.effects).toEqual([{ type: "frame.preparing", target: A, attempt: attempt(claiming.state), cursor: 4 }])
  const late = preparingFrame("focused").answer(claiming.state)

  const handoff = replay([{ type: "preparing.unmounted", target: A, cursor: 4 }], claiming.state)
  expect(handoff.state).toMatchObject({ status: "handoff", cursor: 4 })
  expect(handoff.effects).toEqual([{ type: "frame.cancel" }])
  expect(transitionComposerFocus(handoff.state, late).state).toBe(handoff.state)
})

test("a user who left the pending composer keeps focus when the session composer replaces it", () => {
  const declined = replay([
    ...typing,
    { type: "preparing.blurred", target: A },
    { type: "preparing.unmounted", target: A, cursor: 4 },
  ])

  expect(declined.state).toMatchObject({ status: "declined", target: A })

  const mounted = replay([{ type: "real.mounted", target: A }], declined.state)
  expect(mounted.state).toMatchObject({ status: "idle", target: A })
  expect(mounted.effects).toEqual([])
  expect(needsRealComposerFocus(mounted.state, A)).toBe(false)
  expect(transitionComposerFocus(mounted.state, { type: "real.ready", target: A, cursor: 4 }).state).toBe(mounted.state)

  // Coming back to the session later opens it as usual.
  const revisit = replay(
    [
      { type: "target.changed", target: B },
      { type: "target.changed", target: A },
      { type: "real.mounted", target: A },
    ],
    mounted.state,
  )

  expect(revisit.state).toMatchObject({ status: "pending-real", target: A, cursor: undefined })
})

test("a control or dialog that holds focus on the pending composer's first frame counts as leaving it", () => {
  const blocked = replay([
    { type: "target.changed", target: A },
    { type: "preparing.mounted", target: A, cursor: 0 },
    preparingFrame("blocked"),
    { type: "preparing.unmounted", target: A, cursor: 0 },
  ])

  expect(blocked.state).toMatchObject({ status: "declined" })
})

test("returning to the pending composer before the session is created hands focus over again", () => {
  const result = replay([
    ...typing,
    { type: "preparing.blurred", target: A },
    { type: "preparing.focused", target: A },
    { type: "preparing.unmounted", target: A, cursor: 7 },
  ])

  expect(result.state).toMatchObject({ status: "handoff", cursor: 7 })
})

test("focusing the pending composer before its first frame cancels the frame", () => {
  const result = replay([
    { type: "target.changed", target: A },
    { type: "preparing.mounted", target: A, cursor: 0 },
    { type: "preparing.focused", target: A },
  ])

  expect(result.state).toMatchObject({ status: "preparing", focus: "focused" })
  expect(result.effects).toEqual([{ type: "frame.cancel" }])
})

test("opening a session focuses its composer at the stored caret", () => {
  const result = replay([
    { type: "target.changed", target: A },
    { type: "real.mounted", target: A },
    { type: "real.ready", target: A, cursor: 5 },
  ])

  expect(result.effects).toEqual([
    { type: "timer.clear" },
    { type: "frame.real", target: A, attempt: attempt(result.state), cursor: 5 },
  ])

  const claimed = replay([realFrame("claimed")], result.state)
  expect(claimed.state).toMatchObject({ status: "idle", target: A })

  // A remounted composer, such as after the mobile changes view, focuses again.
  const remounted = replay([{ type: "real.mounted", target: A }], claimed.state)
  expect(remounted.state).toMatchObject({ status: "pending-real", target: A })
})

test("a composer hidden again before its frame waits again, up to the retry limit", () => {
  const ready: Step[] = [{ type: "real.ready", target: A, cursor: 3 }]

  const opened = replay([
    { type: "target.changed", target: A },
    { type: "real.mounted", target: A },
    ...ready,
  ])

  const retried = Array.from({ length: REAL_FOCUS_RETRY_LIMIT }).reduce<ComposerFocusState>((state, _, index) => {
    const result = replay([realFrame("blocked")], state)
    expect(result.state).toMatchObject({ status: "pending-real", cursor: 3, retries: index + 1 })
    expect(result.effects).toEqual([
      { type: "timer.start", attempt: attempt(result.state), delayMs: FOCUS_HANDOFF_TIMEOUT_MS },
    ])

    return replay(ready, result.state).state
  }, opened.state)

  const result = replay([realFrame("blocked")], retried)
  expect(result.state).toMatchObject({ status: "idle", target: A })
  expect(result.effects).toEqual([])
})

test("a composer that never becomes focusable gives up at the timeout, ignoring stale timers", () => {
  const waiting = replay([
    { type: "target.changed", target: A },
    { type: "real.mounted", target: A },
  ])

  const stale = transitionComposerFocus(waiting.state, { type: "timeout", attempt: attempt(waiting.state) - 1 })
  expect(stale.state).toBe(waiting.state)

  const result = replay([timeout], waiting.state)
  expect(result.state).toMatchObject({ status: "idle", target: A })
  expect(transitionComposerFocus(result.state, { type: "real.ready", target: A, cursor: 0 }).state).toBe(result.state)
})

test("stale frames from an earlier phase are ignored", () => {
  const opened = replay([
    { type: "target.changed", target: A },
    { type: "real.mounted", target: A },
    { type: "real.ready", target: A, cursor: 0 },
  ])

  const late = realFrame("focused").answer(opened.state)
  const again = replay([realFrame("blocked"), { type: "real.ready", target: A, cursor: 0 }], opened.state)
  expect(again.state).toMatchObject({ status: "focusing-real" })
  expect(transitionComposerFocus(again.state, late).state).toBe(again.state)
})

test("switching sessions cancels the previous session's frame and timer and ignores its late events", () => {
  const claiming = replay([
    { type: "target.changed", target: A },
    { type: "preparing.mounted", target: A, cursor: 0 },
  ])

  const late = preparingFrame("focused").answer(claiming.state)

  const switched = replay([{ type: "target.changed", target: B }], claiming.state)
  expect(switched.state).toMatchObject({ status: "idle", target: B })
  expect(switched.effects).toEqual([{ type: "frame.cancel" }])
  const after = replay([late, { type: "preparing.unmounted", target: A, cursor: 0 }], switched.state)
  expect(after.state).toBe(switched.state)

  const waiting = replay([{ type: "real.mounted", target: B }], switched.state)
  expect(replay([{ type: "target.changed", target: A }], waiting.state).effects).toEqual([{ type: "timer.clear" }])

  // The pending composer may unmount before or after the route reports the new session.
  const unmountedFirst = replay(
    [
      { type: "preparing.unmounted", target: A, cursor: 0 },
      { type: "target.changed", target: B },
      { type: "real.mounted", target: B },
    ],
    claiming.state,
  )

  expect(unmountedFirst.state).toMatchObject({ status: "pending-real", target: B, cursor: undefined })
})

test("disposal cancels pending work and ignores every later event", () => {
  const waiting = replay([
    { type: "target.changed", target: A },
    { type: "real.mounted", target: A },
  ])

  expect(replay([{ type: "disposed" }], waiting.state).effects).toEqual([{ type: "timer.clear" }])

  const focusing = replay([{ type: "real.ready", target: A, cursor: 0 }], waiting.state)
  const disposed = replay([{ type: "disposed" }], focusing.state)
  expect(disposed.effects).toEqual([{ type: "frame.cancel" }])

  const later = replay(
    [
      { type: "target.changed", target: B },
      { type: "real.mounted", target: B },
    ],
    disposed.state,
  )

  expect(later.state).toBe(disposed.state)
  expect(later.log).toEqual([])
})

test("each machine starts from its own state", () => {
  expect(createComposerFocusState()).not.toBe(createComposerFocusState())
})
