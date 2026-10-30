import { expect, test } from "bun:test"
import { Effect, Fiber } from "effect"

// Guards patches/effect@4.0.1.patch: a fiber that outlives an Effect.fn call inherits its stack frame, and the frame
// must not keep the call's arguments alive.
test("a fiber forked inside Effect.fn does not keep the call's arguments alive", async () => {
  const start = Effect.fn("start")(function* (input: { payload: string }) {
    void input.payload.length
    return yield* Effect.forkDetach(Effect.never)
  })
  const forked = await (async () => {
    const input = { payload: "x".repeat(1_000_000) }
    return { ref: new WeakRef(input), fiber: await Effect.runPromise(start(input)) }
  })()

  // JSC scans the native stack conservatively, so a stale pointer can survive one collection.
  for (let attempt = 0; attempt < 50 && forked.ref.deref(); attempt++) {
    Bun.gc(true)
    await Bun.sleep(1)
  }

  expect(forked.ref.deref()).toBeUndefined()
  await Effect.runPromise(Fiber.interrupt(forked.fiber))
})
