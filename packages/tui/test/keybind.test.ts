import { expect, test } from "bun:test"
import { resolve } from "../src/config"
import { TuiKeybind } from "../src/config/keybind"
import { parse } from "../src/config/v1/keybind"

test("binds agent cycling only to shift+tab by default", () => {
  expect(TuiKeybind.Definitions["agent.cycle"].default).toBe("shift+tab")
  expect(TuiKeybind.Definitions["agent.cycle.reverse"].default).toBe("none")
})

test("treats none inside a keybind array as disabled", () => {
  expect(
    resolve({ keybinds: { "session.sidebar.toggle": ["none"] } }, { terminalSuspend: true }).keybinds.get(
      "session.sidebar.toggle",
    ),
  ).toEqual([])
  expect(
    resolve({ keybinds: { "session.sidebar.toggle": ["none", "ctrl+b"] } }, { terminalSuspend: true }).keybinds.get(
      "session.sidebar.toggle",
    ),
  ).toMatchObject([{ key: "ctrl+b" }])
  expect(parse({ sidebar_toggle: ["none"] }).sidebar_toggle).toEqual([])
})
