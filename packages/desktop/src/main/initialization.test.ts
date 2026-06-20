import { describe, expect, test } from "bun:test"
import { Deferred, Effect } from "effect"

import { forwardInitializationFailure } from "./initialization"

describe("forwardInitializationFailure", () => {
  test("fails the initialization deferred when startup fails", async () => {
    const initialization = Deferred.makeUnsafe<string, unknown>()
    const startupError = new Error("sidecar startup failed")

    await expect(
      Effect.runPromise(Effect.fail(startupError).pipe(forwardInitializationFailure(initialization))),
    ).rejects.toThrow("sidecar startup failed")
    await expect(Effect.runPromise(Deferred.await(initialization))).rejects.toThrow("sidecar startup failed")
  })
})
