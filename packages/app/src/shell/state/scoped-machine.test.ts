import { expect, test } from "bun:test"
import {
  canPruneSessions,
  INITIAL_SCOPED_SESSION_STATE,
  selectActiveSessionKey,
  transitionScopedSession,
  type ScopedSessionEvent,
} from "./scoped-machine"

const replay = (events: ScopedSessionEvent[], state = INITIAL_SCOPED_SESSION_STATE) =>
  events.reduce(
    (current, event) => {
      const next = transitionScopedSession(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] as unknown[] },
  )

test("a store tracked before the layout loads merges before the startup prune drops sessions", () => {
  const result = replay([{ type: "track", name: "plugin-a" }, { type: "touch", sessionKey: "s1" }, { type: "hydrated" }])

  expect(result.effects).toEqual([
    { type: "scoped.merge", names: ["plugin-a"] },
    { type: "session.prune", keep: "s1" },
  ])
  expect(selectActiveSessionKey(result.state)).toBe("s1")
})

test("nothing prunes before both stores load", () => {
  const hydrating = replay([{ type: "touch", sessionKey: "s1" }]).state

  expect(canPruneSessions(hydrating)).toBe(false)
  expect(selectActiveSessionKey(hydrating)).toBe("s1")
})

test("loaded before any session, the first session prunes once", () => {
  const awaiting = replay([{ type: "hydrated" }])
  expect(awaiting.effects).toEqual([])
  expect(canPruneSessions(awaiting.state)).toBe(true)

  const result = replay(
    [
      { type: "touch", sessionKey: "s1" },
      { type: "touch", sessionKey: "s2" },
      { type: "hydrated" },
    ],
    awaiting.state,
  )
  expect(result.effects).toEqual([{ type: "session.prune", keep: "s1" }])
  expect(selectActiveSessionKey(result.state)).toBe("s2")
})

test("a store tracked after loading merges at once", () => {
  const loaded = replay([{ type: "touch", sessionKey: "s1" }, { type: "hydrated" }]).state

  expect(replay([{ type: "track", name: "plugin-b" }], loaded).effects).toEqual([
    { type: "scoped.merge", names: ["plugin-b"] },
  ])
})

test("disposing ignores later events", () => {
  const disposed = replay([{ type: "track", name: "plugin-a" }, { type: "disposed" }]).state

  expect(replay([{ type: "hydrated" }], disposed)).toEqual({ state: disposed, effects: [] })
})
