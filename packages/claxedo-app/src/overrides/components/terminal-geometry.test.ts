import { describe, expect, test } from "bun:test"
import { hostStable, shouldRecoverDesync, shouldSendResize, sizeSane } from "./terminal-geometry"

describe("terminal geometry guards", () => {
  test("resize_rejected_when_host_unstable", () => {
    expect(shouldSendResize({ cols: 80, rows: 24 }, { width: 10, height: 10 })).toBe(false)
  })

  test("hostStable rejects tiny host while layout is mounting", () => {
    expect(hostStable({ width: 12, height: 10 })).toBe(false)
    expect(hostStable({ width: 200, height: 120 })).toBe(true)
  })

  test("sizeSane rejects implausibly low cols for measured host width", () => {
    expect(sizeSane({ cols: 3, rows: 24 }, { width: 640, height: 240 })).toBe(false)
    expect(sizeSane({ cols: 50, rows: 24 }, { width: 640, height: 240 })).toBe(true)
  })

  test("shouldSendResize requires both stable host and sane size", () => {
    expect(shouldSendResize({ cols: 80, rows: 24 }, { width: 12, height: 10 })).toBe(false)
    expect(shouldSendResize({ cols: 3, rows: 24 }, { width: 640, height: 240 })).toBe(false)
    expect(shouldSendResize({ cols: 80, rows: 24 }, { width: 640, height: 240 })).toBe(true)
  })

  test("shouldRecoverDesync enforces threshold and cooldown", () => {
    expect(shouldRecoverDesync({ suspect: 2, now: 5000, last: 0 })).toBe(false)
    expect(shouldRecoverDesync({ suspect: 3, now: 1000, last: 0, cooldownMs: 2000 })).toBe(false)
    expect(shouldRecoverDesync({ suspect: 3, now: 5000, last: 0 })).toBe(true)
  })

  test("repeated_bad_resize_triggers_single_desync_recovery_per_cooldown", () => {
    const input = { suspect: 3, threshold: 3, cooldownMs: 1000 }
    expect(shouldRecoverDesync({ ...input, now: 1000, last: 0 })).toBe(true)
    expect(shouldRecoverDesync({ ...input, now: 1500, last: 1000 })).toBe(false)
    expect(shouldRecoverDesync({ ...input, now: 2100, last: 1000 })).toBe(true)
  })
})
