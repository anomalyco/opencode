import { expect, test } from "bun:test"
import { formatKeySequence } from "@/cli/cmd/tui/keymap"
import type { TuiConfig } from "@/cli/cmd/tui/config/tui"

const config = {
  keybinds: {
    get: () => [],
  },
} as unknown as TuiConfig.Resolved

test("formatKeySequence tolerates missing command bindings", () => {
  expect(formatKeySequence(undefined, config)).toBe("")
  expect(formatKeySequence([], config)).toBe("")
})
