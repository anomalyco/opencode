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

  test("sizeSane rejects cols below ratio threshold for host width", () => {
    // width=640 → expectedCols=floor(640/7)=91, minCols=floor(91*0.35)=31
    expect(sizeSane({ cols: 3, rows: 24 }, { width: 640, height: 240 })).toBe(false)
    expect(sizeSane({ cols: 30, rows: 24 }, { width: 640, height: 240 })).toBe(false)
    expect(sizeSane({ cols: 32, rows: 24 }, { width: 640, height: 240 })).toBe(true)
    expect(sizeSane({ cols: 50, rows: 24 }, { width: 640, height: 240 })).toBe(true)
    // cols < 2 is always rejected regardless of host
    expect(sizeSane({ cols: 1, rows: 24 }, { width: 640, height: 240 })).toBe(false)
  })

  test("shouldSendResize requires both stable host and sane size", () => {
    expect(shouldSendResize({ cols: 80, rows: 24 }, { width: 12, height: 10 })).toBe(false)
    expect(shouldSendResize({ cols: 3, rows: 24 }, { width: 640, height: 240 })).toBe(false)
    expect(shouldSendResize({ cols: 80, rows: 24 }, { width: 640, height: 240 })).toBe(true)
  })

  test("shouldRecoverDesync requires suspect count >= threshold", () => {
    expect(shouldRecoverDesync({ suspect: 2, now: 5000, last: 0 })).toBe(false)
    expect(shouldRecoverDesync({ suspect: 3, now: 5000, last: 0 })).toBe(true)
  })

  test("shouldRecoverDesync requires cooldown elapsed since last recovery", () => {
    // Default cooldown is 1500ms, comparison is strict < (elapsed >= cooldown passes)
    expect(shouldRecoverDesync({ suspect: 3, now: 1000, last: 0 })).toBe(false)
    expect(shouldRecoverDesync({ suspect: 3, now: 1499, last: 0 })).toBe(false)
    expect(shouldRecoverDesync({ suspect: 3, now: 1500, last: 0 })).toBe(true)
    // Custom cooldown
    expect(shouldRecoverDesync({ suspect: 3, now: 1999, last: 0, cooldownMs: 2000 })).toBe(false)
    expect(shouldRecoverDesync({ suspect: 3, now: 2000, last: 0, cooldownMs: 2000 })).toBe(true)
  })

  test("repeated_bad_resize_triggers_single_desync_recovery_per_cooldown", () => {
    const input = { suspect: 3, threshold: 3, cooldownMs: 1000 }
    expect(shouldRecoverDesync({ ...input, now: 1000, last: 0 })).toBe(true)
    expect(shouldRecoverDesync({ ...input, now: 1500, last: 1000 })).toBe(false)
    expect(shouldRecoverDesync({ ...input, now: 2100, last: 1000 })).toBe(true)
  })
})
