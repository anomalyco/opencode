import { test, expect } from "bun:test"
import { getTermSize } from "@/terminal/window/WindowSize"

test("getTermSize returns numeric dimensions", () => {
  const size = getTermSize()
  expect(typeof size.width).toBe("number")
  expect(typeof size.height).toBe("number")
  expect(size.width).toBeGreaterThan(0)
  expect(size.height).toBeGreaterThan(0)
})

test("getTermSize returns fallback dimensions when not a TTY", () => {
  const prev = process.stdout.isTTY
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
  try {
    const size = getTermSize()
    expect(size.width).toBe(80)
    expect(size.height).toBe(24)
  } finally {
    Object.defineProperty(process.stdout, "isTTY", { value: prev, configurable: true })
  }
})
