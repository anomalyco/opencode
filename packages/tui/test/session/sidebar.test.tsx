import { expect, test } from "bun:test"
import { sidebarVisibleForMode } from "../../src/routes/session/sidebar"

test("hidden when mode is auto and screen is narrow", () =>
  expect(sidebarVisibleForMode("auto", false)).toBe(false))

test("visible when mode is auto and screen is wide", () =>
  expect(sidebarVisibleForMode("auto", true)).toBe(true))

test("hidden when mode is hide regardless of width", () => {
  expect(sidebarVisibleForMode("hide", false)).toBe(false)
  expect(sidebarVisibleForMode("hide", true)).toBe(false)
})

test("regression: toggling auto on narrow screen does NOT force visibility", () => {
  // Before the fix, sidebarOpen would have overridden the width check
  // and forced the sidebar visible even on narrow screens.
  expect(sidebarVisibleForMode("auto", false)).toBe(false)
  expect(sidebarVisibleForMode("auto", false)).toBe(false) // idempotent
})
