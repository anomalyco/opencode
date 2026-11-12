import { expect, test } from "bun:test"
import {
  clampSessionTabsWidth,
  INBOX_SIDEBAR_MAX_WIDTH,
  INBOX_SIDEBAR_MIN_WIDTH,
  INBOX_SIDEBAR_WIDTH,
  sessionInboxWidth,
  sessionTabsFitVertically,
  SESSION_SIDEBAR_MAX_WIDTH,
  SESSION_SIDEBAR_WIDTH,
  SESSION_TABS_COMPACT_WIDTH,
} from "../../src/ui/layout"

test("the Inbox is wider than tabs by default and keeps its own width bounds", () => {
  expect(INBOX_SIDEBAR_WIDTH).toBe(64)
  expect(INBOX_SIDEBAR_WIDTH).toBeGreaterThan(SESSION_SIDEBAR_WIDTH)
  expect(sessionInboxWidth(240)).toBe(INBOX_SIDEBAR_WIDTH)
  expect(sessionInboxWidth(240, 0)).toBe(INBOX_SIDEBAR_MIN_WIDTH)
  expect(sessionInboxWidth(240, 1000)).toBe(INBOX_SIDEBAR_MAX_WIDTH)
  expect(sessionInboxWidth(240, 80)).toBe(80)
})

test("Inbox bounds preserve transcript space and tabs fit in the remaining columns", () => {
  expect(sessionInboxWidth(75)).toBe(0)
  expect(sessionInboxWidth(76)).toBe(32)
  expect(sessionInboxWidth(100, 96)).toBe(56)
  expect(sessionTabsFitVertically(170 - sessionInboxWidth(170))).toBe(true)
  expect(sessionTabsFitVertically(169 - sessionInboxWidth(169))).toBe(false)
})

test("vertical tabs match the session sidebar and preserve readable content width", () => {
  expect(SESSION_SIDEBAR_WIDTH).toBe(42)
  expect(sessionTabsFitVertically(106)).toBe(true)
  expect(sessionTabsFitVertically(105)).toBe(false)
})

test("vertical tabs account for a resized width", () => {
  expect(sessionTabsFitVertically(124, 60)).toBe(true)
  expect(sessionTabsFitVertically(123, 60)).toBe(false)
})

test("vertical tab width preserves minimum rail and content widths", () => {
  expect(clampSessionTabsWidth(0, 120)).toBe(SESSION_TABS_COMPACT_WIDTH)
  expect(clampSessionTabsWidth(11, 120)).toBe(11)
  expect(clampSessionTabsWidth(12, 120)).toBe(12)
  expect(clampSessionTabsWidth(50, 120)).toBe(50)
  expect(clampSessionTabsWidth(100, 120)).toBe(SESSION_SIDEBAR_MAX_WIDTH)
  expect(clampSessionTabsWidth(100, 100)).toBe(56)
  expect(clampSessionTabsWidth(42, 54)).toBe(10)
  expect(sessionTabsFitVertically(69, SESSION_TABS_COMPACT_WIDTH)).toBe(true)
  expect(sessionTabsFitVertically(68, SESSION_TABS_COMPACT_WIDTH)).toBe(false)
})
