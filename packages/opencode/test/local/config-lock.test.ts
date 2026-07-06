import { expect, test } from "bun:test"
import { Effect } from "effect"
import { withGlobalConfigLock } from "../../src/local/config-lock"

// Two concurrent read-modify-write sequences must both survive: the second
// begins only after the first's write is visible (re-read inside the lock).
test("config lock: concurrent read-modify-writes both survive", async () => {
  let store: Record<string, string> = {}
  const readModifyWrite = (key: string) =>
    withGlobalConfigLock(
      Effect.gen(function* () {
        const snapshot = { ...store } // read INSIDE the lock
        yield* Effect.sleep("20 millis") // widen the race window
        store = { ...snapshot, [key]: key }
      }),
    )

  await Effect.runPromise(Effect.all([readModifyWrite("a"), readModifyWrite("b")], { concurrency: 2 }))

  expect(store).toEqual({ a: "a", b: "b" })
})

// Control: the same interleaving without the lock loses an update — proves
// the test would catch a regression to unserialized writes.
test("config lock: control shows unserialized writes lose updates", async () => {
  let store: Record<string, string> = {}
  const unlocked = (key: string) =>
    Effect.gen(function* () {
      const snapshot = { ...store }
      yield* Effect.sleep("20 millis")
      store = { ...snapshot, [key]: key }
    })

  await Effect.runPromise(Effect.all([unlocked("a"), unlocked("b")], { concurrency: 2 }))

  expect(Object.keys(store).length).toBe(1)
})
