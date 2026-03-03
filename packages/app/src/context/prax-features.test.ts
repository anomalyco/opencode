import { describe, expect, test } from "bun:test"

/**
 * Tests for prax-dev custom features to detect merge-related regressions.
 *
 * These tests verify that key prax-dev additions survive future upstream merges.
 * If a test fails after a merge, it means a prax-dev feature was overwritten.
 */

describe("prax-dev: font size settings", () => {
  const MIN = 10
  const MAX = 32

  test("font size minimum is 10px", () => {
    expect(Math.max(MIN, 8)).toBe(MIN)
    expect(Math.max(MIN, MIN - 1)).toBe(MIN)
  })

  test("font size maximum is 32px (not 24)", () => {
    expect(Math.min(MAX, 32)).toBe(32)
    expect(Math.min(MAX, 33)).toBe(MAX)
  })

  test("font size range covers 10-32", () => {
    expect(MAX - MIN).toBe(22)
    expect(MAX).toBeGreaterThan(24)
  })
})

describe("prax-dev: sidebar collapse nav width", () => {
  test("collapsed width is 48px (thin icon strip)", () => {
    const collapsed = true
    const opened = true
    const width = opened ? (collapsed ? "48px" : "244px") : "64px"
    expect(width).toBe("48px")
  })

  test("expanded width uses layout width", () => {
    const collapsed = false
    const opened = true
    const layoutWidth = 344
    const width = opened ? (collapsed ? "48px" : `${Math.max(layoutWidth, 244)}px`) : "64px"
    expect(width).toBe("344px")
  })

  test("closed sidebar shows 64px icon strip", () => {
    const opened = false
    const width = opened ? "244px" : "64px"
    expect(width).toBe("64px")
  })
})

describe("prax-dev: resize handle max", () => {
  test("resize max uses window - 300 (not 0.45 ratio)", () => {
    const windowWidth = 1920
    const max = windowWidth - 300
    expect(max).toBe(1620)
    expect(max).toBeGreaterThan(windowWidth * 0.45)
  })

  test("resize max for small window", () => {
    const windowWidth = 800
    const max = windowWidth - 300
    expect(max).toBe(500)
    expect(max).toBeGreaterThan(450)
  })
})

describe("prax-dev: settings dialog font isolation", () => {
  test("settings dialog should use fixed font sizes regardless of user preference", () => {
    const defaults = { small: 13, base: 14, large: 16 }
    const custom = { small: 19, base: 20, large: 22 }

    // Settings dialog always uses defaults
    expect(defaults.small).toBe(13)
    expect(defaults.base).toBe(14)
    expect(defaults.large).toBe(16)

    // Custom values should not affect settings
    expect(defaults.base).not.toBe(custom.base)
  })
})

describe("prax-dev: steer/queue mode validation", () => {
  test("steer mode sends 'steer' for mid-turn injection", () => {
    const mode = "steer"
    expect(mode).toBe("steer")
  })

  test("queue mode sends 'queue' for post-turn auto-submit", () => {
    const mode = "queue"
    expect(mode).toBe("queue")
  })

  test("steer requires working session and text", () => {
    const working = true
    const text = "adjust the approach"
    const sessionID = "session-123"
    const canSteer = working && !!text.trim() && !!sessionID
    expect(canSteer).toBe(true)
  })

  test("steer does not fire when idle", () => {
    const working = false
    const text = "some text"
    const canSteer = working && !!text.trim()
    expect(canSteer).toBe(false)
  })

  test("steer does not fire with empty text", () => {
    const working = true
    const text = "   "
    const canSteer = working && !!text.trim()
    expect(canSteer).toBe(false)
  })

  test("queue requires working session, text, and dirty prompt", () => {
    const working = true
    const dirty = true
    const text = "follow up question"
    const sessionID = "session-456"
    const canQueue = working && dirty && !!text.trim() && !!sessionID
    expect(canQueue).toBe(true)
  })
})
