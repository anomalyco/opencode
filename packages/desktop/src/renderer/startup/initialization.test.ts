import { describe, expect, test } from "bun:test"
import { initializationData } from "./initialization"

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
    const sidecar = { url: "http://127.0.0.1:1234", username: "opencode", password: "secret" }

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
})
