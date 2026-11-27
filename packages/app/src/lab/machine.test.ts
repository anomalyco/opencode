import { expect, test } from "bun:test"
import {
  createLabStageState,
  INITIAL_LAB_BROWSE_STATE,
  labStageIndex,
  selectShouldToggleFolder,
  transitionLabBrowse,
  transitionLabStage,
  type LabBrowseEvent,
  type LabBrowseState,
  type LabStageEvent,
  type LabStageState,
  type LabStageTransition,
} from "./machine"

/** Each event's effects from `state`, and the state after the last. */
const browse = (state: LabBrowseState, ...events: LabBrowseEvent[]) =>
  events.reduce<{ state: LabBrowseState; effects: string[] }>(
    (current, event) => {
      const next = transitionLabBrowse(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects.map((effect) => effect.type)] }
    },
    { state, effects: [] },
  )

test("focus moving inside the stage at rest stays at rest", () => {
  const focused = browse(INITIAL_LAB_BROWSE_STATE, { type: "stage.focused" }, { type: "stage.focused" })

  expect(focused.state).toBe(INITIAL_LAB_BROWSE_STATE)
  expect(focused.effects).toEqual([])

  // Many focus moves later, a story opened from the tree still gets exactly three returns.
  const opened = browse(
    focused.state,
    { type: "story.opened", fromTree: true },
    ...Array.from({ length: 4 }, () => ({ type: "stage.focused" }) as const),
  )

  expect(opened.effects).toEqual(["focus.tree", "focus.tree", "focus.tree"])
  expect(opened.state).toBe(INITIAL_LAB_BROWSE_STATE)
})

test.each([{ type: "key.ended" }, { type: "window.blurred" }] as const)(
  "a Space press in the tree no longer toggles folders after $type",
  (end) => {
    const pressed = browse(INITIAL_LAB_BROWSE_STATE, { type: "key.down", key: " ", inTree: true })

    expect(selectShouldToggleFolder(pressed.state)).toBe(true)
    expect(selectShouldToggleFolder(browse(pressed.state, end).state)).toBe(false)
  },
)

test("a Space press outside the tree and arrow keys in it never toggle folders", () => {
  expect(selectShouldToggleFolder(INITIAL_LAB_BROWSE_STATE)).toBe(false)
  expect(browse(INITIAL_LAB_BROWSE_STATE, { type: "key.down", key: " ", inTree: false }).state).toBe(
    INITIAL_LAB_BROWSE_STATE,
  )
  expect(
    selectShouldToggleFolder(
      browse(
        INITIAL_LAB_BROWSE_STATE,
        { type: "key.down", key: " ", inTree: true },
        { type: "key.down", key: "ArrowDown", inTree: true },
      ).state,
    ),
  ).toBe(false)
})

test("a click in the tree toggles folders until the press ends", () => {
  const pressed = browse(INITIAL_LAB_BROWSE_STATE, { type: "pointer.down", inTree: true })

  expect(selectShouldToggleFolder(pressed.state)).toBe(true)
  expect(browse(pressed.state, { type: "pointer.ended" }).state).toBe(INITIAL_LAB_BROWSE_STATE)
})

test.each([
  { type: "key.down", key: "Tab", inTree: true },
  { type: "pointer.down", inTree: false },
] as const)("$type ends browsing before the stage takes focus", (exit) => {
  const ended = browse(INITIAL_LAB_BROWSE_STATE, { type: "story.opened", fromTree: true }, exit, {
    type: "stage.focused",
  })

  expect(ended.effects).toEqual([])
  expect(ended.state).toBe(INITIAL_LAB_BROWSE_STATE)
})

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
  expect(rebuilt.state.status).toBe("playing")
})

test("Play advances even when the panel reports no change, and a later hand still stops it", () => {
  const twins = createLabStageState(["Open", "Open"])
  const advanced = run(twins, { type: "play" }, { type: "tick", attempt: 1 })
  expect(labStageIndex(advanced.state)).toBe(1)
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

test("Play while playing, Pause while paused and Play with one state do nothing", () => {
  const paused = createLabStageState(names)
  expect(transitionLabStage(paused, { type: "pause" })).toEqual({ state: paused, effects: [] })

  const playing = run(paused, { type: "play" }).state
  expect(transitionLabStage(playing, { type: "play" })).toEqual({ state: playing, effects: [] })

  const single = createLabStageState(["Only"])
  expect(transitionLabStage(single, { type: "play" })).toEqual({ state: single, effects: [] })
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
  expect(labStageIndex(transitionLabStage(replayed.state, { type: "tick", attempt: 2 }).state)).toBe(1)
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
