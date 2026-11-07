import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Detaching } from "@opencode/core/detaching"
import { it } from "./lib/effect"

describe("Detaching", () => {
  it.effect("detaches only on a shutdown after a prepared handoff", () =>
    Effect.gen(function* () {
      const quit = yield* Detaching.make
      expect(yield* quit.begin).toBe(false)
      const detaching = yield* Detaching.make
      yield* detaching.handoffPrepared
      expect(detaching.isDetaching()).toBe(false)
      expect(yield* detaching.begin).toBe(true)
      expect(detaching.isDetaching()).toBe(true)
    }),
  )

  it.effect("does not detach once the prepared handoff was dropped", () =>
    Effect.gen(function* () {
      const detaching = yield* Detaching.make
      yield* detaching.handoffPrepared
      yield* detaching.handoffDropped
      expect(yield* detaching.begin).toBe(false)
      expect(detaching.isStopping()).toBe(true)
    }),
  )

  it.effect("starts stopping on any shutdown, detaching or not", () =>
    Effect.gen(function* () {
      const detaching = yield* Detaching.make
      expect(detaching.isStopping()).toBe(false)
      expect(yield* detaching.begin).toBe(false)
      expect(detaching.isStopping()).toBe(true)
      expect(detaching.isDetaching()).toBe(false)
    }),
  )
})
