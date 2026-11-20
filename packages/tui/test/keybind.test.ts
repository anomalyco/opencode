import { expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"

test("binds agent cycling only to shift+tab by default", () => {
  expect(TuiKeybind.Definitions["agent.cycle"].default).toBe("shift+tab")
  expect(TuiKeybind.Definitions["agent.cycle.reverse"].default).toBe("none")
})

test("binds keypad arrows for vertical input movement", () => {
  expect(TuiKeybind.Definitions["input.move.up"].default).toBe("up,kpup")
  expect(TuiKeybind.Definitions["input.move.down"].default).toBe("down,kpdown")
})
