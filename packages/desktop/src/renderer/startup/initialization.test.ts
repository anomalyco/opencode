import { describe, expect, test } from "bun:test"
import { createSidecarResolver, initializationData } from "./initialization"

describe("desktop renderer initialization", () => {
  test("throws the original initialization error before rendering server providers", () => {
    const error = new Error("sidecar startup failed")

    try {
      initializationData(Object.assign(() => undefined, { error }))
      throw new Error("expected initialization to fail")
    } catch (failure) {
      expect(failure).toBe(error)
      expect((failure as Error & { localServerStartup?: boolean }).localServerStartup).toBe(true)
    }
  })

  test("preserves clean RPC startup errors", () => {
    const error = new Error("Cannot migrate session_message projections")

    try {
      initializationData(Object.assign(() => undefined, { error }))
      throw new Error("expected initialization to fail")
    } catch (failure) {
      expect(failure).toBe(error)
      expect((failure as Error).message).toBe("Cannot migrate session_message projections")
    }
  })

  test("returns initialized sidecar data", () => {
    const sidecar = { url: "http://127.0.0.1:1234", password: "secret" }

    expect(initializationData(Object.assign(() => sidecar, { error: undefined }))).toBe(sidecar)
  })

  test("does not discard falsy initialization errors", () => {
    let caught: unknown
    try {
      initializationData(Object.assign(() => undefined, { error: "" }))
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    if (!(caught instanceof Error)) return
    expect(caught.message).toBe("")
    expect((caught as Error & { localServerStartup?: boolean }).localServerStartup).toBe(true)
  })

  test("refreshes the managed sidecar endpoint", async () => {
    const sidecar = { url: "http://127.0.0.1:4321", password: "next" }
    const updates: (typeof sidecar)[] = []
    const resolve = createSidecarResolver({
      api: { reconnectService: async () => sidecar },
      current: () => undefined,
      update: (next) => updates.push(next),
    })

    expect(await resolve(new AbortController().signal)).toEqual({ url: sidecar.url })
    expect(updates).toEqual([sidecar])
  })

  test("keeps the current sidecar when reconnection resolves the same endpoint", async () => {
    const sidecar = { url: "http://127.0.0.1:4321", password: "same" }
    const updates: (typeof sidecar)[] = []
    const resolve = createSidecarResolver({
      api: { reconnectService: async () => ({ ...sidecar }) },
      current: () => sidecar,
      update: (next) => updates.push(next),
    })

    expect(await resolve(new AbortController().signal)).toEqual({ url: sidecar.url })
    expect(updates).toEqual([])
  })

  test("does not publish a sidecar resolved after cancellation", async () => {
    const sidecar = { url: "http://127.0.0.1:4321", password: "next" }
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
