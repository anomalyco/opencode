import { expect, test } from "bun:test"
import {
  COMPACTION_GRACE_MS,
  COMPACTION_RECENT_DONE_MS,
  createCompactionEntranceState,
  DISPOSED_COMPACTION_ENTRANCE_EVENT,
  GRACE_ELAPSED_EVENT,
  selectCompactionEnter,
  transitionCompactionEntrance,
} from "./compaction-entrance-machine"

const finished = { type: "running.changed", running: false } as const

test("a compaction that finishes inside the grace fades in as Compacted", () => {
  const started = createCompactionEntranceState({ ageMs: 0, running: true })
  expect(selectCompactionEnter(started.state)).toBe("grace")
  expect(started.effects).toEqual([{ type: "schedule-grace", delayMs: COMPACTION_GRACE_MS }])

  const ended = transitionCompactionEntrance(started.state, finished)
  expect(selectCompactionEnter(ended.state)).toBe("now")
  expect(ended.effects).toEqual([{ type: "cancel-grace" }])
})

// The grace ended only by comparing clocks inside an effect, so whether a compaction finishing near 400 ms restarted
// its fade as "now" or rolled Compacting to Compacted depended on when the effect ran.
test("once the grace passes, finishing rolls the label in place without restarting the entrance", () => {
  const revealed = transitionCompactionEntrance(
    createCompactionEntranceState({ ageMs: 0, running: true }).state,
    GRACE_ELAPSED_EVENT,
  )
  expect(selectCompactionEnter(revealed.state)).toBe("grace")

  const ended = transitionCompactionEntrance(revealed.state, finished)
  expect(ended.state).toBe(revealed.state)
  expect(ended.effects).toEqual([])
})

test.each([
  { name: "running", ageMs: COMPACTION_GRACE_MS, running: true },
  { name: "finished", ageMs: COMPACTION_RECENT_DONE_MS, running: false },
])("a $name compaction loaded with the history has no entrance", (input) => {
  const loaded = createCompactionEntranceState(input)

  expect(selectCompactionEnter(loaded.state)).toBeUndefined()
  expect(loaded.effects).toEqual([])
})

test("a compaction that had just finished when it mounted fades in as Compacted", () => {
  expect(selectCompactionEnter(createCompactionEntranceState({ ageMs: 600, running: false }).state)).toBe("now")
})

test("disposing inside the grace cancels it, and a late grace is ignored", () => {
  const disposed = transitionCompactionEntrance(
    createCompactionEntranceState({ ageMs: 0, running: true }).state,
    DISPOSED_COMPACTION_ENTRANCE_EVENT,
  )

  expect(disposed.effects).toEqual([{ type: "cancel-grace" }])
  expect(transitionCompactionEntrance(disposed.state, GRACE_ELAPSED_EVENT).state).toBe(disposed.state)
})
