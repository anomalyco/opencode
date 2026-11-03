import { expect, test } from "bun:test"
import { appBindingCommands, appGlobalBindingCommands } from "../src/app"

// Regression test for #61365: the question form pushes its own keymap mode,
// and only global bindings stay reachable in a pushed mode (see
// keymap-scope.test.tsx). terminal.suspend must therefore be bound globally,
// or ctrl+z does nothing while the form is open.
test("terminal.suspend is bound in every keymap mode", () => {
  expect(appGlobalBindingCommands).toContain("terminal.suspend")
  expect(appBindingCommands).not.toContain("terminal.suspend")
})
