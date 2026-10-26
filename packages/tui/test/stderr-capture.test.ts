import { expect, test } from "bun:test"
import { captureStderr } from "#stderr-capture"

// Setup and restore an own-property isTTY on process.stderr; the runner's
// stderr is a pipe (isTTY false or undefined), and the instance descriptor is
// replaced for the duration of each test.
function withStderrTTY<T>(value: boolean, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY")
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true })
  try {
    return fn()
  } finally {
    if (descriptor) Object.defineProperty(process.stderr, "isTTY", descriptor)
    else delete (process.stderr as { isTTY?: boolean }).isTTY
  }
}

test("capture is skipped when explicitly disabled via OPENCODE_TUI_STDERR", () => {
  const previous = process.env.OPENCODE_TUI_STDERR
  process.env.OPENCODE_TUI_STDERR = "inherit"
  try {
    expect(withStderrTTY(true, () => captureStderr("/tmp/opencode-tui-stderr-capture-test"))).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_TUI_STDERR
    else process.env.OPENCODE_TUI_STDERR = previous
  }
})

test("capture is skipped when stderr is redirected away from the terminal", () => {
  expect(withStderrTTY(false, () => captureStderr("/tmp/opencode-tui-stderr-capture-test"))).toBeUndefined()
})
