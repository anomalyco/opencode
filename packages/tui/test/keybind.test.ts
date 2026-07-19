import { expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"

test("binds agent cycling only to shift+tab by default", () => {
  expect(TuiKeybind.Definitions.agent_cycle.default).toBe("shift+tab")
  expect(TuiKeybind.Definitions.agent_cycle_reverse.default).toBe("none")
})
