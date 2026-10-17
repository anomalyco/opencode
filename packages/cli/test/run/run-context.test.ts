import { describe, expect, test } from "bun:test"
import { assertRunContext } from "../../src/run/run"

describe("run session context", () => {
  test("rejects nested agent sessions and allows a top-level invocation", () => {
    expect(() => assertRunContext("ses_parent", [])).toThrow("nested OpenCode session")
    expect(() => assertRunContext(undefined, [])).not.toThrow()
  })

  test("rejects an OpenCode ancestor even when the session environment was stripped", () => {
    expect(() => assertRunContext(undefined, ["zsh -c task", "/usr/local/bin/opencode serve --service"]))
      .toThrow("nested OpenCode session")
    expect(() => assertRunContext(undefined, ["/usr/local/bin/opencode-notebook"]))
      .not.toThrow()
  })
})
