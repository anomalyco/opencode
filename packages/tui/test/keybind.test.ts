import { expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"

test("binds agent cycling only to shift+tab by default", () => {
  expect(TuiKeybind.Definitions["agent.cycle"].default).toBe("shift+tab")
  expect(TuiKeybind.Definitions["agent.cycle.reverse"].default).toBe("none")
})

test("binds keypad mirrors for every default using a bare navigation key", () => {
  const mirrors = {
    up: "kpup",
    down: "kpdown",
    left: "kpleft",
    right: "kpright",
    home: "kphome",
    end: "kpend",
    pageup: "kppageup",
    pagedown: "kppagedown",
  } as const

  const violations = Object.entries(TuiKeybind.Definitions).flatMap(([id, definition]) => {
    const value = definition.default
    if (typeof value !== "string") return []
    const tokens = value.split(",").map((token) => token.trim())
    const missing = tokens
      .filter((token): token is keyof typeof mirrors => token in mirrors)
      .map((token) => mirrors[token])
      .filter((mirror) => !tokens.includes(mirror))
    return missing.length ? [`${id}: ${missing.join(", ")}`] : []
  })

  expect(violations).toEqual([])
})
