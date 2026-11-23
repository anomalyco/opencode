import { describe, expect, test } from "bun:test"
import {
  INITIAL_SCROLL_PERSISTENCE_STATE,
  transitionScrollPersistence,
  type ScrollPersistenceEvent,
  type ScrollPersistenceState,
} from "./scroll-machine"

function replay(events: ScrollPersistenceEvent[], state: ScrollPersistenceState = INITIAL_SCROLL_PERSISTENCE_STATE) {
  return events.reduce<{ state: ScrollPersistenceState; effects: unknown[][] }>(
    (acc, event) => {
      const result = transitionScrollPersistence(acc.state, event)

      return { state: result.state, effects: [...acc.effects, [...result.effects]] }
    },
    { state, effects: [] },
  )
}

describe("scroll persistence", () => {
  test("disposing writes the positions still waiting in the debounce", () => {
    const result = replay([
      { type: "edited", sessionKey: "first" },
      { type: "edited", sessionKey: "second" },
      { type: "disposed" },
    ])

    expect(result.effects.at(-1)).toEqual([
      { type: "timer.clear", sessionKeys: ["first", "second"] },
      { type: "flush", sessionKeys: ["first", "second"] },
    ])
    expect(result.state).toEqual({ status: "disposed" })
  })

  test("further scroll frames in a debounce window keep the state and reschedule the write", () => {
    const first = transitionScrollPersistence(INITIAL_SCROLL_PERSISTENCE_STATE, { type: "edited", sessionKey: "s" })
    const second = transitionScrollPersistence(first.state, { type: "edited", sessionKey: "s" })

    expect(second.state).toBe(first.state)
    expect(second.effects).toEqual([{ type: "timer.schedule", sessionKey: "s" }])
  })

  test("a session writes once per debounce window", () => {
    const result = replay([
      { type: "edited", sessionKey: "s" },
      { type: "flushed", sessionKey: "s" },
      { type: "flushed", sessionKey: "s" },
    ])

    expect(result.effects.slice(1)).toEqual([
      [
        { type: "timer.clear", sessionKeys: ["s"] },
        { type: "flush", sessionKeys: ["s"] },
      ],
      [],
    ])
    expect(result.state).toBe(INITIAL_SCROLL_PERSISTENCE_STATE)
  })

  test("flushing all writes every waiting session at once", () => {
    const result = replay([
      { type: "edited", sessionKey: "first" },
      { type: "edited", sessionKey: "second" },
      { type: "flush-all" },
      { type: "flush-all" },
    ])

    expect(result.effects.slice(2)).toEqual([
      [
        { type: "timer.clear", sessionKeys: ["first", "second"] },
        { type: "flush", sessionKeys: ["first", "second"] },
      ],
      [],
    ])
  })

  test("a dropped session discards its waiting write", () => {
    const result = replay([
      { type: "edited", sessionKey: "dirty" },
      { type: "dropped", sessionKeys: ["dirty", "clean"] },
      { type: "dropped", sessionKeys: [] },
    ])

    expect(result.effects.slice(1)).toEqual([
      [
        { type: "timer.clear", sessionKeys: ["dirty"] },
        { type: "cache.drop", sessionKeys: ["dirty", "clean"] },
      ],
      [],
    ])
    expect(result.state).toBe(INITIAL_SCROLL_PERSISTENCE_STATE)
  })

  test("a disposed store ignores later events", () => {
    const disposed = replay([{ type: "disposed" }]).state

    expect(
      replay(
        [
          { type: "edited", sessionKey: "s" },
          { type: "flushed", sessionKey: "s" },
          { type: "flush-all" },
          { type: "disposed" },
        ],
        disposed,
      ),
    ).toEqual({ state: disposed, effects: [[], [], [], []] })
  })
})
