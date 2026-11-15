import { expect, test } from "bun:test"
import type { Installed } from "@opencode/plugin/gui/host"
import {
  createStartupGateState,
  selectDisabled,
  selectHostReady,
  selectInstalled,
  selectMainFailed,
  selectServersReady,
  transitionStartupGate,
  type StartupGateEffect,
  type StartupGateEvent,
  type StartupGateState,
} from "./machine"

const desktop = { bridge: true, preload: true, plugins: ["review", "terminal"], servers: true }

const ids = ["review", "terminal", "notes"]

const builtins = new Set(["review", "terminal"])

const notesOff: Installed[] = [{ id: "notes", builtin: false, enabled: false }]

const settled: StartupGateEvent[] = [
  { type: "plugin.settled", id: "review" },
  { type: "plugin.settled", id: "terminal" },
]

/** Folds events through the machine from the initial state, collecting every effect in order. */
function replay(input: Parameters<typeof createStartupGateState>[0], events: readonly StartupGateEvent[]) {
  const initial = createStartupGateState(input)

  return events.reduce<{ state: StartupGateState; effects: StartupGateEffect[] }>(
    (current, event) => {
      const next = transitionStartupGate(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state: initial.state, effects: [...initial.effects] },
  )
}

function view(state: StartupGateState) {
  return {
    status: state.status,
    host: selectHostReady(state),
    servers: selectServersReady(state),
    disabled: selectDisabled(state, ids, builtins),
    mainFailed: selectMainFailed(state, "notes"),
  }
}

test.each<{ name: string; preload: boolean; events: StartupGateEvent[] }>([
  { name: "no preload snapshot, then list() rejects", preload: false, events: [] },
  {
    name: "the preload snapshot is unknown, then list() rejects",
    preload: true,
    events: [{ type: "preload.unavailable" }],
  },
])("startup reaches ready when main never answers: $name", (input) => {
  const replayed = replay({ ...desktop, preload: input.preload }, [
    ...input.events,
    { type: "list.failed", error: "ipc down" },
  ])

  // Before the fix the window waited here forever, with nothing activated.
  expect(view(replayed.state)).toEqual({
    status: "activating",
    host: false,
    servers: false,
    disabled: new Set(["notes"]),
    mainFailed: true,
  })

  const done = replay({ ...desktop, preload: input.preload }, [
    ...input.events,
    { type: "list.failed", error: "ipc down" },
    ...settled,
    { type: "inventory.settled" },
    { type: "sources.settled" },
  ])

  expect(view(done.state)).toEqual({
    status: "ready",
    host: true,
    servers: true,
    disabled: new Set(["notes"]),
    mainFailed: true,
  })
  expect(done.effects.at(-1)).toEqual({ type: "timer.stop" })
})

test("startup does not activate on a failed preload while list() can still answer", () => {
  const replayed = replay({ ...desktop, preload: true }, [{ type: "preload.unavailable" }])

  expect(view(replayed.state)).toEqual({
    status: "preferences",
    host: false,
    servers: false,
    disabled: undefined,
    mainFailed: false,
  })
})

test("a list() failure waits for the preload snapshot, whose rows then apply", () => {
  const waiting = replay(desktop, [{ type: "list.failed", error: "boom" }])

  expect(waiting.state).toMatchObject({ status: "preferences", pending: { kind: "preload", error: "boom" } })

  const replayed = replay(desktop, [
    { type: "list.failed", error: "boom" },
    { type: "preload.resolved", rows: [{ id: "notes", enabled: true }] },
  ])

  expect(view(replayed.state)).toMatchObject({ status: "activating", disabled: new Set(), mainFailed: true })
})

test("preferences that never arrive time out to built-ins only, and a late list still applies", () => {
  const timedOut = replay(desktop, [{ type: "timeout", timer: "preferences" }])

  expect(view(timedOut.state)).toMatchObject({ status: "activating", disabled: new Set(["notes"]), mainFailed: false })
  expect(timedOut.effects.at(-1)).toEqual({ type: "timer.start", timer: "activation" })

  const answered = replay(desktop, [
    { type: "timeout", timer: "preferences" },
    { type: "list.resolved", list: [{ id: "notes", builtin: false, enabled: true }] },
  ])

  expect(view(answered.state)).toMatchObject({ status: "activating", disabled: new Set() })
})

test("a built-in whose load or store read never settles stops holding the window when activation times out", () => {
  const replayed = replay({ ...desktop, servers: false }, [
    { type: "preload.resolved", rows: [] },
    { type: "plugin.settled", id: "review" },
  ])

  expect(replayed.state).toMatchObject({ status: "activating", pending: ["terminal"] })

  const done = transitionStartupGate(replayed.state, { type: "timeout", timer: "activation" })

  expect(view(done.state)).toMatchObject({ status: "ready", host: true, servers: true })
})

test("the servers phase opens on its timeout when a source never reports", () => {
  const replayed = replay(desktop, [{ type: "preload.resolved", rows: [] }, ...settled, { type: "inventory.settled" }])

  expect(view(replayed.state)).toMatchObject({ status: "servers", host: true, servers: false })

  const done = transitionStartupGate(replayed.state, { type: "timeout", timer: "servers" })

  expect(view(done.state)).toMatchObject({ status: "ready", servers: true })
})

test("an inventory that settles before the servers phase is remembered", () => {
  const replayed = replay(desktop, [{ type: "inventory.settled" }, { type: "preload.resolved", rows: [] }, ...settled])

  expect(replayed.state).toMatchObject({ status: "servers", pending: "sources" })
  expect(transitionStartupGate(replayed.state, { type: "sources.settled" }).state.status).toBe("ready")
})

test("the preload snapshot opens the gate without waiting for list(), whose reply then keeps unlisted rows", () => {
  const replayed = replay({ ...desktop, servers: false }, [
    { type: "preload.resolved", rows: [{ id: "notes", enabled: false }] },
    ...settled,
  ])

  expect(view(replayed.state)).toMatchObject({ status: "ready", disabled: new Set(["notes"]) })

  const listed = transitionStartupGate(replayed.state, {
    type: "list.resolved",
    list: [{ id: "review", builtin: true, enabled: true }],
  })

  expect(selectDisabled(listed.state, ids, builtins)).toEqual(new Set(["notes"]))
  expect(selectInstalled(listed.state)).toEqual([{ id: "review", builtin: true, enabled: true }])
})

test("a list main pushes wins over the older list() reply", () => {
  const replayed = replay(desktop, [
    { type: "installed.pushed", list: notesOff },
    { type: "list.resolved", list: [{ id: "notes", builtin: false, enabled: true }] },
  ])

  expect(selectInstalled(replayed.state)).toEqual(notesOff)
  expect(selectDisabled(replayed.state, ids, builtins)).toEqual(new Set(["notes"]))
})

test("a pushed list recovers a window whose manager failed at startup", () => {
  const replayed = replay({ ...desktop, preload: false, servers: false }, [
    { type: "list.failed", error: "ipc down" },
    ...settled,
    { type: "installed.pushed", list: [{ id: "notes", builtin: false, enabled: true }] },
  ])

  expect(view(replayed.state)).toMatchObject({ status: "ready", disabled: new Set(), mainFailed: false })
})

test("ready is terminal: late phase events and timers change nothing", () => {
  const ready = replay({ ...desktop, servers: false }, [{ type: "preload.resolved", rows: [] }, ...settled]).state

  const late: StartupGateEvent[] = [
    { type: "plugin.settled", id: "review" },
    { type: "preload.unavailable" },
    { type: "inventory.settled" },
    { type: "sources.settled" },
    { type: "timeout", timer: "preferences" },
    { type: "timeout", timer: "activation" },
    { type: "timeout", timer: "servers" },
    { type: "preload.resolved", rows: notesOff },
  ]

  late.forEach((event) => expect(transitionStartupGate(ready, event)).toEqual({ state: ready, effects: [] }))
  late.forEach((event) => expect(transitionStartupGate(ready, event).state).toBe(ready))
})

test("a window without a bridge starts ready when nothing holds it", () => {
  expect(createStartupGateState({ bridge: false, preload: false, plugins: [], servers: false })).toEqual({
    state: { status: "ready", preferences: { status: "loaded", preload: [], list: [] } },
    effects: [{ type: "timer.stop" }],
  })
})
