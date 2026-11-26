import { expect, test } from "bun:test"
import {
  createLocationMissingState,
  selectLocationMissingView,
  transitionLocationMissing,
  type LocationMissingEffect,
  type LocationMissingEvent,
  type LocationMissingState,
} from "./location-missing-machine"

const sibling = "/repo/.worktrees/sibling"

function replay(events: LocationMissingEvent[], from = createLocationMissingState()) {
  return events.reduce<{ state: LocationMissingState; effects: readonly LocationMissingEffect[] }>(
    (current, event) => transitionLocationMissing(current.state, event),
    { state: from, effects: [] },
  )
}

const attempt = (state: LocationMissingState) => ("attempt" in state ? state.attempt : -1)

test("an open directory picker refuses a second picker or a worktree move, and its answer after unmount moves nothing", () => {
  const picking = replay([{ type: "choose.requested" }])

  expect(picking.effects).toEqual([{ type: "picker.open", attempt: 1 }])
  expect(selectLocationMissingView(picking.state).disabled).toBe(true)
  expect(transitionLocationMissing(picking.state, { type: "choose.requested" }).state).toBe(picking.state)
  expect(transitionLocationMissing(picking.state, { type: "move.worktree", directory: sibling }).state).toBe(
    picking.state,
  )

  const disposed = transitionLocationMissing(picking.state, { type: "disposed" })

  const late = transitionLocationMissing(disposed.state, {
    type: "picker.settled",
    attempt: attempt(picking.state),
    directory: "/elsewhere",
    dialogOpen: false,
  })

  expect(late.effects).toEqual([])
})

test("a picked folder moves the session once", () => {
  const picked = replay([
    { type: "choose.requested" },
    { type: "picker.settled", attempt: 1, directory: "/elsewhere", dialogOpen: false },
  ])

  expect(picked.effects).toEqual([{ type: "move.run", attempt: 2, directory: "/elsewhere" }])
  expect(selectLocationMissingView(picked.state).pendingDirectory).toBe(true)
  expect(
    transitionLocationMissing(picked.state, {
      type: "picker.settled",
      attempt: 1,
      directory: "/elsewhere",
      dialogOpen: false,
    }).state,
  ).toBe(picked.state)
})

test("a move the server accepted keeps the controls busy until the notice unmounts, or for its settle bound", () => {
  const moving = replay([{ type: "move.worktree" }])

  expect(moving.effects).toEqual([{ type: "move.run", attempt: 1 }])

  const moved = transitionLocationMissing(moving.state, { type: "move.succeeded", attempt: 1 })

  expect(moved.effects).toEqual([{ type: "timer.start", attempt: 1 }])
  expect(selectLocationMissingView(moved.state)).toMatchObject({ pendingWorktree: true, disabled: true })
  expect(transitionLocationMissing(moved.state, { type: "move.worktree" }).state).toBe(moved.state)
  expect(transitionLocationMissing(moved.state, { type: "choose.requested" }).state).toBe(moved.state)

  const settled = transitionLocationMissing(moved.state, { type: "move.settle-timed-out", attempt: 1 })

  expect(settled.state).toMatchObject({ status: "idle" })
  expect(selectLocationMissingView(settled.state).disabled).toBe(false)
})

test("a cancelled pick or failed move returns focus to Choose directory once no dialog covers it", () => {
  const cancelled = replay([
    { type: "choose.requested" },
    { type: "picker.settled", attempt: 1, directory: undefined, dialogOpen: false },
  ])

  expect(cancelled.effects).toEqual([{ type: "focus.choose" }])

  const failed = replay([
    { type: "move.worktree" },
    { type: "move.failed", attempt: 1, error: new Error("denied"), dialogOpen: true },
  ])

  expect(failed.effects).toEqual([{ type: "toast.move-failed", error: new Error("denied") }])
  expect(transitionLocationMissing(failed.state, { type: "dialog.changed", open: false }).effects).toEqual([
    { type: "focus.choose" },
  ])
})
