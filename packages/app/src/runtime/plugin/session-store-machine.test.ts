import { expect, test } from "bun:test"
import {
  createSessionStoreState,
  selectSessionStoreEntry,
  SESSION_STORE_MAX_UNLISTED,
  transitionSessionStore,
  type SessionStoreEvent,
  type SessionStoreState,
} from "./session-store-machine"

/** Folds events from an empty table, collecting the stores each one closed. */
function replay(events: readonly SessionStoreEvent<string>[], state = createSessionStoreState<string>()) {
  return events.reduce<{ state: SessionStoreState<string>; closed: string[] }>(
    (current, event) => {
      const next = transitionSessionStore(current.state, event)

      return { state: next.state, closed: [...current.closed, ...next.effects.map((effect) => effect.value)] }
    },
    { state, closed: [] },
  )
}

const opened = (key: string, input: { listed?: boolean; routed?: string } = {}): SessionStoreEvent<string> => ({
  type: "opened",
  key,
  value: key,
  listed: input.listed ?? false,
  routed: input.routed,
})

const sync = (listed: readonly string[], routed?: string): SessionStoreEvent<string> => ({
  type: "sync",
  listed: new Set(listed),
  routed,
})

const open = (state: SessionStoreState<string>) => (state.status === "active" ? Object.keys(state.entries).sort() : [])

// Before, a store no tab ever listed stayed open until the plugin went away.
test("stores no tab lists close oldest first past the cap, except the routed session's", () => {
  const keys = Array.from({ length: SESSION_STORE_MAX_UNLISTED + 3 }, (_, index) => `s${index}`)
  const run = replay(keys.map((key) => opened(key, { routed: "s0" })))

  expect({ closed: run.closed, routed: open(run.state).includes("s0") }).toEqual({ closed: ["s1", "s2"], routed: true })

  // Once the route leaves it, the routed store counts against the cap too.
  expect(replay([sync([])], run.state).closed).toEqual(["s0"])
})

test("an unlisted store survives until a tab lists it, then closes with that tab once the route leaves it", () => {
  const steps = [
    { event: opened("a", { routed: "a" }), open: ["a"] },
    { event: sync([], "a"), open: ["a"] },
    { event: sync(["a"], "a"), open: ["a"] },
    { event: sync([], "a"), open: ["a"] },
    { event: sync([], undefined), open: [] },
  ]

  const states = steps.reduce<SessionStoreState<string>[]>(
    (all, item) => [...all, transitionSessionStore(all.at(-1) ?? createSessionStoreState(), item.event).state],
    [],
  )

  expect(states.map(open)).toEqual(steps.map((item) => item.open))
})

test("a store opened for a listed session closes with its tab", () => {
  expect(replay([opened("a", { listed: true }), sync(["b"])]).closed).toEqual(["a"])
})

test("a sync that changes nothing keeps the same state", () => {
  const run = replay([opened("a"), opened("b", { listed: true })])

  expect(transitionSessionStore(run.state, sync(["b"])).state).toBe(run.state)
})

test("disposal closes every store once and closes a store opened afterwards at once", () => {
  const run = replay([opened("a"), opened("b", { listed: true }), { type: "disposed" }, opened("c"), sync([])])

  expect({ closed: run.closed, status: run.state.status, read: selectSessionStoreEntry(run.state, "a") }).toEqual({
    closed: ["a", "b", "c"],
    status: "disposed",
    read: undefined,
  })
})
