import { expect, test } from "bun:test"
import {
  INITIAL_KEYBIND_SUSPEND_STATE,
  selectKeybindsSuspended,
  transitionKeybindSuspend,
  type KeybindSuspendEvent,
  type KeybindSuspendState,
} from "./suspend-machine"

const run = (state: KeybindSuspendState, ...events: KeybindSuspendEvent[]) =>
  events.reduce(transitionKeybindSuspend, state)

test("a caller releasing twice keeps another caller's suspension", () => {
  const both = run(INITIAL_KEYBIND_SUSPEND_STATE, { type: "suspend" }, { type: "suspend" })

  expect(both).toEqual({ status: "suspended", issued: 2, holds: [1, 2] })

  const released = run(both, { type: "resume", hold: 1 })

  expect(run(released, { type: "resume", hold: 1 }, { type: "keybinds", enabled: true })).toBe(released)
  expect(selectKeybindsSuspended(released)).toBe(true)

  const active = run(released, { type: "resume", hold: 2 })

  expect(active).toEqual({ status: "active", issued: 2 })
  expect(selectKeybindsSuspended(active)).toBe(false)
  expect(run(active, { type: "resume", hold: 2 })).toBe(active)
  expect(run(active, { type: "suspend" })).toEqual({ status: "suspended", issued: 3, holds: [3] })
})

test("a repeated keybinds(false) resumes on one keybinds(true)", () => {
  const off = run(INITIAL_KEYBIND_SUSPEND_STATE, { type: "keybinds", enabled: false })

  expect(run(off, { type: "keybinds", enabled: false })).toBe(off)
  expect(selectKeybindsSuspended(run(off, { type: "keybinds", enabled: true }))).toBe(false)
})

test.each([
  [
    "the lease outlives the toggle",
    [
      { type: "keybinds", enabled: true },
      { type: "resume", hold: 1 },
    ],
  ],
  [
    "the toggle outlives the lease",
    [
      { type: "resume", hold: 1 },
      { type: "keybinds", enabled: true },
    ],
  ],
] satisfies [string, KeybindSuspendEvent[]][])("keybinds stay suspended until every hold ends: %s", (_, releases) => {
  const held = run(INITIAL_KEYBIND_SUSPEND_STATE, { type: "suspend" }, { type: "keybinds", enabled: false })
  const partial = run(held, releases[0])

  expect(selectKeybindsSuspended(partial)).toBe(true)
  expect(selectKeybindsSuspended(run(partial, releases[1]))).toBe(false)
})
