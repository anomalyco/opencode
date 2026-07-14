import { describe, expect, test } from "bun:test"
import {
  layoutTransitionState,
  maximumSunsetTimeout,
  newLayoutDesignsDefault,
  nextSunsetCheckDelay,
  resolveNewLayoutDesigns,
  shouldEnableNewLayout,
} from "./settings"

describe("layout transition", () => {
  test("blank profiles default to the new layout", () => {
    expect(newLayoutDesignsDefault).toBe(true)
  })

  test("hides the transition until a sunset is scheduled", () => {
    expect(layoutTransitionState(false, true, false, false)).toEqual({ available: false, notice: false })
  })

  test("existing profiles can switch before sunset", () => {
    expect(layoutTransitionState(true, true, false, false)).toEqual({ available: true, notice: false })
  })

  test("preserves explicit and default layout preferences", () => {
    expect(resolveNewLayoutDesigns(false, false, true)).toBe(false)
    expect(resolveNewLayoutDesigns(false, undefined, false)).toBe(false)
    expect(resolveNewLayoutDesigns(false, undefined, true)).toBe(true)
  })

  test("sunset replaces the toggle with a dismissible notice", () => {
    expect(layoutTransitionState(true, true, true, false)).toEqual({ available: false, notice: true })
    expect(layoutTransitionState(true, true, true, true)).toEqual({ available: false, notice: false })
    expect(resolveNewLayoutDesigns(true, false)).toBe(true)
  })

  test("caps checks for sunsets beyond the browser timeout limit", () => {
    expect(nextSunsetCheckDelay(maximumSunsetTimeout + 1_000, 0)).toBe(maximumSunsetTimeout)
    expect(nextSunsetCheckDelay(10_000, 9_000)).toBe(1_000)
    expect(nextSunsetCheckDelay(9_000, 10_000)).toBe(0)
  })

  test("enables the new layout when upgrading from 1.17.20 or earlier", () => {
    expect(shouldEnableNewLayout("v1.17.20", "1.17.21")).toBe(true)
    expect(shouldEnableNewLayout("1.16.9", "2.0.0")).toBe(true)
  })

  test("does not enable the new layout without a qualifying upgrade", () => {
    expect(shouldEnableNewLayout("1.17.20", "1.17.20")).toBe(false)
    expect(shouldEnableNewLayout("1.17.21", "1.17.22")).toBe(false)
    expect(shouldEnableNewLayout(undefined, "1.17.21")).toBe(false)
    expect(shouldEnableNewLayout("dev", "1.17.21")).toBe(false)
  })
})
