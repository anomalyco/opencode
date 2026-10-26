import { expect, test } from "bun:test"
import { fstatSync, mkdtempSync, readFileSync, statSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStderr } from "#stderr-capture"

// Replace the own-property isTTY on process.stderr for the duration of fn; the
// runner's stderr is a pipe (isTTY false or undefined).
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

const dir = () => mkdtempSync(join(tmpdir(), "opencode-tui-stderr-"))

test("capture is skipped when explicitly disabled via OPENCODE_TUI_STDERR", () => {
  const previous = process.env.OPENCODE_TUI_STDERR
  process.env.OPENCODE_TUI_STDERR = "inherit"
  try {
    expect(withStderrTTY(true, () => captureStderr(dir()))).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_TUI_STDERR
    else process.env.OPENCODE_TUI_STDERR = previous
  }
})

test("capture is skipped when stderr is redirected away from the terminal", () => {
  expect(withStderrTTY(false, () => captureStderr(dir()))).toBeUndefined()
})

// Exercises the real capture: fd 2 is repointed at the log file under the test.
test.skipIf(process.platform === "win32")("fd 2 writes land in tui-stderr.log and restore reattaches stderr", () => {
  const captured = withStderrTTY(true, () => captureStderr(dir()))
  if (!captured) throw new Error("capture should be available on this platform")
  // While the capture holds fd 2, fd 2 maps to the capture file itself.
  expect(fstatSync(2).ino).toBe(statSync(captured.path).ino)
  try {
    writeSync(2, "captured-during\n")
    captured.restore()
    // restore() points fd 2 back at the runner's stderr, so the file is no
    // longer the fd 2 target and nothing written now reaches it.
    expect(fstatSync(2).ino).not.toBe(statSync(captured.path).ino)
    const text = readFileSync(captured.path, "utf8")
    expect(text).toContain("captured-during")
    // restore() must be safe to repeat without corrupting reused fds.
    captured.restore()
    expect(fstatSync(2).ino).not.toBe(statSync(captured.path).ino)
    expect(readFileSync(captured.path, "utf8")).not.toContain("restored-after")
  } finally {
    captured.restore()
  }
})
