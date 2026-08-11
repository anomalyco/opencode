import { expect, test } from "bun:test"
import { TabPosition } from "../../src/config"
import {
  effectiveSessionTabPosition,
  SESSION_SIDEBAR_WIDTH,
  sessionTabSidebarWidth,
  sessionTabsFitVertically,
} from "../../src/ui/layout"

test("vertical tabs match the session sidebar and preserve compact content width", () => {
  expect(SESSION_SIDEBAR_WIDTH).toBe(42)
  expect(sessionTabsFitVertically(86)).toBe(true)
  expect(sessionTabsFitVertically(85)).toBe(false)
})

test("preserves all tab positions when they fit", () => {
  expect(TabPosition.literals.map((position) => effectiveSessionTabPosition(position, 120))).toEqual([
    ...TabPosition.literals,
  ])
})

test("falls side tabs back to the top strip when narrow", () => {
  expect(effectiveSessionTabPosition("left", 85)).toBe("top")
  expect(effectiveSessionTabPosition("right", 85)).toBe("top")
  expect(sessionTabSidebarWidth("left", 85)).toBe(0)
  expect(sessionTabSidebarWidth("right", 86)).toBe(SESSION_SIDEBAR_WIDTH)
})
