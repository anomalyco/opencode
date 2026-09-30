import { expect, test } from "bun:test"
import { trayLabel, trayLabelWidth } from "./tray-label"

test("normalizes line breaks and whitespace before truncating", () => {
  expect(trayLabel("  Fix\r\n login\t redirects\u2028now  ")).toBe("Fix login redirects now")
  expect(trayLabel("abcdefghijklmnop", 10)).toBe("abcdefghi…")
  expect(trayLabel("short", 10)).toBe("short")
})

test("keeps Unicode graphemes intact and budgets for wide characters", () => {
  expect(trayLabel("项目名称项目名称", 7)).toBe("项目名…")
  expect(trayLabel("👩‍💻👩‍💻👩‍💻", 5)).toBe("👩‍💻👩‍💻…")
  expect(trayLabel("e\u0301e\u0301e\u0301e\u0301", 3)).toBe("e\u0301e\u0301…")
  expect(trayLabelWidth(trayLabel("项目名称".repeat(20)))).toBeLessThanOrEqual(44)
  expect(trayLabel("long", 1)).toBe("…")
  expect(trayLabel("long", 0)).toBe("")
})
