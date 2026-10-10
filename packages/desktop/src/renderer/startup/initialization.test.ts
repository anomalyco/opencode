import { describe, expect, test } from "bun:test"
import { createSidecarResolver, initializationData, initializationError } from "./initialization"

function failure(error: unknown) {
  try {
    initializationData(Object.assign(() => undefined, { error }))
  } catch (caught) {
    return caught
  }
}

describe("desktop renderer initialization", () => {
  test.each([
    new Error("Cannot migrate session_message projections"),
    new Error("Desktop IPC handler failed", {
      cause: { message: "Cannot open database", stack: "original main trace" },
    }),
  ])("preserves the original initialization error and diagnostics (%s)", (error) => {
    const message = error.message
    const stack = error.stack
    const cause = error.cause
    expect(failure(error)).toBe(error)
    expect(error).toHaveProperty("localServerStartup", true)
    expect(error.message).toBe(message)
    expect(error.stack).toBe(stack)
    expect(error.cause).toBe(cause)
  })

  test("normalizes encoded initialization failures before Solid wraps them", () => {
    // A falsy error is still an error.
    const empty = failure("")
    expect(empty).toBeInstanceOf(Error)
    expect(empty).toHaveProperty("message", "")
    expect(empty).toHaveProperty("localServerStartup", true)
    const conflict = { _tag: "LocalServerPortConflict", hostname: "127.0.0.1", port: 49374, message: "port occupied" }
    const typed = initializationError(conflict)
    expect(typed).toHaveProperty("cause", conflict)
    expect(typed).toHaveProperty("message", "port occupied")
    expect(failure(typed)).toBe(typed)
    const sidecar = { url: "http://127.0.0.1:1234" }
    expect(initializationData(Object.assign(() => sidecar, { error: undefined }))).toBe(sidecar)
  })

  test("refreshes the managed sidecar endpoint", async () => {
    const sidecar = { url: "http://127.0.0.1:4321" }
    const updates: (typeof sidecar)[] = []

    const resolve = createSidecarResolver({
      api: { reconnectService: async () => sidecar },
      current: () => undefined,
      update: (next) => updates.push(next),
    })

    expect(await resolve(new AbortController().signal)).toEqual(sidecar)
    expect(updates).toEqual([sidecar])
  })

  test("keeps the current sidecar when reconnection resolves the same endpoint", async () => {
    const sidecar = { url: "http://127.0.0.1:4321" }
    const updates: (typeof sidecar)[] = []

    const resolve = createSidecarResolver({
      api: { reconnectService: async () => ({ ...sidecar }) },
      current: () => sidecar,
      update: (next) => updates.push(next),
    })

    expect(await resolve(new AbortController().signal)).toEqual(sidecar)
    expect(updates).toEqual([])
  })

  test("does not publish a sidecar resolved after cancellation", async () => {
    const sidecar = { url: "http://127.0.0.1:4321" }
    const pending = Promise.withResolvers<typeof sidecar>()
    const updates: (typeof sidecar)[] = []

    const resolve = createSidecarResolver({
      api: { reconnectService: () => pending.promise },
      current: () => undefined,
      update: (next) => updates.push(next),
    })

    const abort = new AbortController()
    const result = resolve(abort.signal)
    abort.abort()
    pending.resolve(sidecar)

    await expect(result).rejects.toBe(abort.signal.reason)
    expect(updates).toEqual([])
  })
})
