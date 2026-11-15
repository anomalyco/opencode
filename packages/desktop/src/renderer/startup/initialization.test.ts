import { describe, expect, test } from "bun:test"
import { createSidecarResolver, localServerStartupError } from "./initialization"

describe("desktop renderer initialization", () => {
  test("keeps the original initialization error, marked as a local server startup", () => {
    const error = new Error("Cannot migrate session_message projections")
    expect(localServerStartupError(error)).toBe(error)
    expect(error).toHaveProperty("localServerStartup", true)
    // The RPC error text reaches the error screen unchanged.
    expect(error.message).toBe("Cannot migrate session_message projections")
    // A falsy error is still an error.
    const empty = localServerStartupError("")
    expect(empty).toBeInstanceOf(Error)
    expect(empty).toHaveProperty("message", "")
    expect(empty).toHaveProperty("localServerStartup", true)
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

  test("does not publish a sidecar resolved after cancellation, and cancels the wait in main", async () => {
    const sidecar = { url: "http://127.0.0.1:4321" }
    const pending = Promise.withResolvers<typeof sidecar>()
    const updates: (typeof sidecar)[] = []
    const signals: (AbortSignal | undefined)[] = []

    const resolve = createSidecarResolver({
      api: {
        reconnectService: (signal) => {
          signals.push(signal)

          return pending.promise
        },
      },
      current: () => undefined,
      update: (next) => updates.push(next),
    })

    const abort = new AbortController()
    const result = resolve(abort.signal)
    abort.abort()
    pending.resolve(sidecar)

    await expect(result).rejects.toBe(abort.signal.reason)
    expect(updates).toEqual([])
    expect(signals).toEqual([abort.signal])
  })
})
