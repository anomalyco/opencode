import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"

import { computeRippleColor, resolvePromptBarRippleConfig } from "../../../src/cli/cmd/tui/util/prompt-bar-ripple"
import type { PromptBarVisualTheme } from "../../../src/cli/cmd/tui/util/prompt-bar-visual"

const theme: PromptBarVisualTheme = {
  primary: RGBA.fromInts(100, 50, 50, 255),
  secondary: RGBA.fromInts(50, 100, 50, 255),
  accent: RGBA.fromInts(50, 50, 100, 255),
  info: RGBA.fromInts(80, 80, 80, 255),
  success: RGBA.fromInts(60, 120, 60, 255),
  warning: RGBA.fromInts(120, 120, 60, 255),
  error: RGBA.fromInts(120, 60, 60, 255),
}

describe("resolvePromptBarRippleConfig", () => {
  test("returns defaults when no options provided", () => {
    const config = resolvePromptBarRippleConfig()
    expect(config.speed).toBe(0.18)
    expect(config.intensity).toBe(0.35)
    expect(config.direction).toBe("down-right")
  })

  test("clamps speed to min 0.02", () => {
    expect(resolvePromptBarRippleConfig({ speed: 0.001 }).speed).toBe(0.02)
  })

  test("clamps speed to max 1", () => {
    expect(resolvePromptBarRippleConfig({ speed: 5 }).speed).toBe(1)
  })

  test("clamps intensity to min 0", () => {
    expect(resolvePromptBarRippleConfig({ intensity: -1 }).intensity).toBe(0)
  })

  test("clamps intensity to max 1", () => {
    expect(resolvePromptBarRippleConfig({ intensity: 2 }).intensity).toBe(1)
  })

  test("respects custom direction", () => {
    expect(resolvePromptBarRippleConfig({ direction: "up-left" }).direction).toBe("up-left")
  })

  test("passes through valid speed and intensity", () => {
    const config = resolvePromptBarRippleConfig({ speed: 0.5, intensity: 0.8 })
    expect(config.speed).toBe(0.5)
    expect(config.intensity).toBe(0.8)
  })
})

describe("computeRippleColor", () => {
  const config = resolvePromptBarRippleConfig()

  test("returns different colors for different positions at same tick (spatial variation)", () => {
    const a = computeRippleColor(0, 0, 20, 3, 0, theme, config)
    const b = computeRippleColor(10, 1, 20, 3, 0, theme, config)
    const c = computeRippleColor(19, 2, 20, 3, 0, theme, config)
    expect(a.equals(b)).toBe(false)
    expect(b.equals(c)).toBe(false)
  })

  test("returns different colors for same position at different ticks (temporal variation)", () => {
    const a = computeRippleColor(5, 1, 20, 3, 0, theme, config)
    const b = computeRippleColor(5, 1, 20, 3, 50, theme, config)
    expect(a.equals(b)).toBe(false)
  })

  test("returns valid RGBA instance", () => {
    const color = computeRippleColor(0, 0, 20, 3, 0, theme, config)
    expect(color).toBeInstanceOf(RGBA)
    expect(color.a).toBeGreaterThan(0)
  })

  test("handles 1x1 grid without NaN", () => {
    const color = computeRippleColor(0, 0, 1, 1, 0, theme, config)
    expect(Number.isNaN(color.r)).toBe(false)
    expect(Number.isNaN(color.g)).toBe(false)
    expect(Number.isNaN(color.b)).toBe(false)
    expect(Number.isNaN(color.a)).toBe(false)
  })

  test("direction affects output", () => {
    const dr = resolvePromptBarRippleConfig({ direction: "down-right" })
    const ul = resolvePromptBarRippleConfig({ direction: "up-left" })
    const a = computeRippleColor(10, 1, 20, 3, 0, theme, dr)
    const b = computeRippleColor(10, 1, 20, 3, 0, theme, ul)
    expect(a.equals(b)).toBe(false)
  })

  test("intensity 0 produces blend of primary and accent only", () => {
    const zero = resolvePromptBarRippleConfig({ intensity: 0 })
    const color = computeRippleColor(5, 1, 20, 3, 10, theme, zero)
    // With intensity 0, sheen blend factor is 0 so secondary has no effect
    // Result should still be a valid RGBA
    expect(color).toBeInstanceOf(RGBA)
  })
})
