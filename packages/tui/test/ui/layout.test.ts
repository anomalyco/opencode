import { expect, test } from "bun:test"
import {
  clampSessionTabsWidth,
  clampTerminalPaneWidth,
  sessionTabsFitVertically,
  SESSION_SIDEBAR_MAX_WIDTH,
  SESSION_SIDEBAR_MIN_WIDTH,
  SESSION_SIDEBAR_WIDTH,
} from "../../src/ui/layout"

test("vertical tabs match the session sidebar and preserve compact content width", () => {
  expect(SESSION_SIDEBAR_WIDTH).toBe(42)
  expect(sessionTabsFitVertically(86)).toBe(true)
  expect(sessionTabsFitVertically(85)).toBe(false)
})

test("vertical tabs account for a resized width", () => {
  expect(sessionTabsFitVertically(104, 60)).toBe(true)
  expect(sessionTabsFitVertically(103, 60)).toBe(false)
})

test("vertical tab width preserves minimum rail and content widths", () => {
  expect(clampSessionTabsWidth(10, 120)).toBe(SESSION_SIDEBAR_MIN_WIDTH)
  expect(clampSessionTabsWidth(50, 120)).toBe(50)
  expect(clampSessionTabsWidth(100, 120)).toBe(SESSION_SIDEBAR_MAX_WIDTH)
  expect(clampSessionTabsWidth(100, 100)).toBe(56)
})

test.each([
  [1, 1],
  [2, 1],
  [3, 1],
  [40, 20],
  [47, 23],
  [60, 30],
  [87, 43],
  [100, 50],
  [181, 90],
])("terminal panes preserve the default half at total width %s", (total, half) => {
  expect(clampTerminalPaneWidth(half, total)).toBe(half)
})

test("terminal width clamps both panes without imposing a wide-screen maximum", () => {
  expect(clampTerminalPaneWidth(1, 180)).toBe(24)
  expect(clampTerminalPaneWidth(90, 180)).toBe(90)
  expect(clampTerminalPaneWidth(200, 180)).toBe(136)
  expect(clampTerminalPaneWidth(200, 100)).toBe(56)
  expect(clampTerminalPaneWidth(200, 60)).toBe(30)
  expect(clampTerminalPaneWidth(1, 40)).toBe(20)
  expect(clampTerminalPaneWidth(200, 1)).toBe(1)
})
