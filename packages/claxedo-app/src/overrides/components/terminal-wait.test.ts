import { describe, expect, test } from "bun:test"
import { initWait, markBytes, markElapsed, markInput, showWaiting, waitProfile } from "./terminal-wait"

describe("terminal wait state", () => {
  test("hides waiting immediately on first output byte", () => {
    const state = markBytes(initWait(false), 1)
    expect(showWaiting(state)).toBe(false)
  })

  test("hides waiting immediately on user input", () => {
    const state = markInput(initWait(false))
    expect(showWaiting(state)).toBe(false)
  })

  test("force-hides waiting after max timeout without bytes", () => {
    let state = initWait(false)
    state = markElapsed(state, 5500)
    expect(showWaiting(state)).toBe(false)
  })

  test("command-start profile requires more bytes before hiding", () => {
    const profile = waitProfile(true)
    let state = initWait(false)
    state = markBytes(state, profile.minReadyBytes - 1, profile.minReadyBytes)
    expect(showWaiting(state)).toBe(true)
    state = markBytes(state, 1, profile.minReadyBytes)
    expect(showWaiting(state)).toBe(false)
  })

  test("command-start profile is stricter than default profile", () => {
    const base = waitProfile(false)
    const profile = waitProfile(true)
    expect(profile.minMs).toBeGreaterThan(base.minMs)
    expect(profile.maxMs).toBeGreaterThan(base.maxMs)
    expect(profile.minReadyBytes).toBeGreaterThan(base.minReadyBytes)
  })
})
