import { afterEach, expect, mock, test } from "bun:test"
import { captureStderr } from "#stderr-capture"

afterEach(() => {
  mock.restore()
})

test("capture is skipped when explicitly disabled via OPENCODE_TUI_STDERR", () => {
  const previous = process.env.OPENCODE_TUI_STDERR
  process.env.OPENCODE_TUI_STDERR = "inherit"
  try {
    expect(captureStderr("/tmp/opencode-tui-stderr-capture-test")).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_TUI_STDERR
    else process.env.OPENCODE_TUI_STDERR = previous
  }
})
