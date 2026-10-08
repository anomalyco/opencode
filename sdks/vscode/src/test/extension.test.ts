import { strict as assert } from "node:assert"
import { suite, test } from "mocha"
import { getOpenCodeLaunchCommand } from "../extension"

suite("OpenCode launch command", () => {
  test("uses the default TUI command for CLI v2 and later", () => {
    assert.equal(getOpenCodeLaunchCommand(2, 56207), "opencode")
  })

  test("preserves the port-based command for CLI v1", () => {
    assert.equal(getOpenCodeLaunchCommand(1, 56207), "opencode --port 56207")
  })
})
