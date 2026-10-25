import { expect, test } from "bun:test"
import { keypadKeyName } from "../src/util/keypad"

test("keypad navigation keys resolve to their regular names", () => {
  expect(
    ["kpup", "kpdown", "kpleft", "kpright", "kppageup", "kppagedown", "kphome", "kpend"].map(keypadKeyName),
  ).toEqual(["up", "down", "left", "right", "pageup", "pagedown", "home", "end"])
})

test("regular names and unrelated keys pass through unchanged", () => {
  for (const name of ["up", "down", "left", "right", "pageup", "pagedown", "home", "end", "escape", "return", "kp0"])
    expect(keypadKeyName(name)).toBe(name)
})
