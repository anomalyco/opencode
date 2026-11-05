import { expect, test } from "bun:test"
import {
  createLabStageState,
  labStageView,
  transitionLabStage,
  type LabStageEvent,
  type LabStageState,
  type LabStageTransition,
} from "./machine"

const names = ["Closed", "Opening", "Open"]

/** The last transition of `events` from `state`. */
const run = (state: LabStageState, ...events: LabStageEvent[]) =>
  events.reduce<LabStageTransition>((current, event) => transitionLabStage(current.state, event), {
    state,
    effects: [],
  })

test("an inspector rebuild after an advance keeps Play running", () => {
  const advanced = run(createLabStageState(names), { type: "play" }, { type: "tick", attempt: 1 })
  expect(advanced.effects).toEqual([
    { type: "state.apply", index: 1, preset: "now" },
    { type: "timer.schedule", attempt: 2 },
  ])

  // A story registering a motion knob rebuilds the panel, which restores the state it was showing.
  const rebuilt = transitionLabStage(advanced.state, { type: "panel.state", name: "Opening", fromPreset: true })
  expect(rebuilt.state).toBe(advanced.state)
  expect(rebuilt.effects).toEqual([])
  expect(labStageView(rebuilt.state).canPause).toBe(true)
})

test("Play advances even when the panel reports no change, and a later hand still stops it", () => {
  const twins = createLabStageState(["Open", "Open"])
  const advanced = run(twins, { type: "play" }, { type: "tick", attempt: 1 })
  expect(labStageView(advanced.state).index).toBe(1)
  expect(advanced.effects.at(-1)).toEqual({ type: "timer.schedule", attempt: 2 })

  const stepped = transitionLabStage(advanced.state, { type: "step", delta: 1 })
  expect(stepped.state.status).toBe("paused")
  expect(stepped.effects).toEqual([{ type: "timer.clear" }, { type: "state.apply", index: 0, preset: "now" }])
})

test("the digit of the state shown pauses Play", () => {
  const paused = run(createLabStageState(names), { type: "play" }, { type: "select", index: 0 })
  expect(paused.state.status).toBe("paused")
  expect(paused.effects).toEqual([{ type: "timer.clear" }, { type: "state.apply", index: 0, preset: "now" }])
})

test("the toolbar offers Play while paused and Pause while playing", () => {
  const paused = createLabStageState(names)
  expect(labStageView(paused)).toEqual({ index: 0, canPlay: true, canPause: false })
  expect(labStageView(run(paused, { type: "play" }).state)).toEqual({ index: 0, canPlay: false, canPause: true })
  expect(labStageView(createLabStageState(["Only"]))).toEqual({ index: 0, canPlay: false, canPause: false })
  expect(transitionLabStage(createLabStageState(["Only"]), { type: "play" }).effects).toEqual([])
  expect(labStageView(run(paused, { type: "disposed" }).state)).toEqual({ index: 0, canPlay: false, canPause: false })
})

test("motion registrations coalesce, and a sync queued before unmount never runs", () => {
  const queued = run(createLabStageState(names), { type: "motion.changed" })
  expect(queued.effects).toEqual([{ type: "motion.queue" }])
  expect(transitionLabStage(queued.state, { type: "motion.changed" }).state).toBe(queued.state)
  expect(transitionLabStage(queued.state, { type: "motion.flushed" }).effects).toEqual([{ type: "motion.sync" }])

  const disposed = transitionLabStage(queued.state, { type: "disposed" })
  expect(transitionLabStage(disposed.state, { type: "motion.flushed" })).toEqual({ state: disposed.state, effects: [] })
})

test("a timer from an earlier Play is ignored", () => {
  const replayed = run(createLabStageState(names), { type: "play" }, { type: "pause" }, { type: "play" })
  expect(replayed.effects).toEqual([{ type: "timer.schedule", attempt: 2 }])
  expect(transitionLabStage(replayed.state, { type: "tick", attempt: 1 }).state).toBe(replayed.state)
  expect(labStageView(transitionLabStage(replayed.state, { type: "tick", attempt: 2 }).state).index).toBe(1)
})

test("Undo or Reset moving the state stops Play and syncs the knobs afterwards", () => {
  const undone = run(
    createLabStageState(names),
    { type: "play" },
    { type: "panel.state", name: "Open", fromPreset: false },
  )

  expect(undone.state.status).toBe("paused")
  expect(undone.effects).toEqual([{ type: "timer.clear" }, { type: "state.apply", index: 2, preset: "later" }])

  const chip = transitionLabStage(undone.state, { type: "panel.state", name: "Closed", fromPreset: true })
  expect(chip.effects).toEqual([{ type: "state.apply", index: 0, preset: "none" }])
})

test("a disposed stage stops its timer and ignores everything after", () => {
  const playing = run(createLabStageState(names), { type: "play" }).state
  const disposed = transitionLabStage(playing, { type: "disposed" })
  expect(disposed.effects).toEqual([{ type: "timer.clear" }])
  expect(transitionLabStage(disposed.state, { type: "tick", attempt: 1 }).state).toBe(disposed.state)
  expect(transitionLabStage(disposed.state, { type: "play" }).effects).toEqual([])
})
