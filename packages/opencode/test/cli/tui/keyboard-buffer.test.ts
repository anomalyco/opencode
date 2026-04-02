import { afterEach, expect, test } from "bun:test"
import { spawn } from "bun-pty"
import { join } from "path"
import stripAnsi from "strip-ansi"

const STARTUP_TIMEOUT = 30_000
const READY_TIMEOUT = 20_000
const TEST_INPUT = "buffer from byte zero 123"

const ptys = new Set<ReturnType<typeof spawn>>()

afterEach(() => {
  ptys.forEach((pty) => pty.kill())
  ptys.clear()
})

function waitFor(condition: () => boolean, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval)
        resolve()
      } else if (Date.now() - start > timeout) {
        clearInterval(interval)
        reject(new Error("Timeout waiting for condition"))
      }
    }, 100)
  })
}

function clean(text: string) {
  return stripAnsi(text)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "\n")
}

function prompt(text: string) {
  // The TUI renders the prompt input area between ┃ border characters. In
  // bun-pty output the rows are concatenated and cursor-movement artifacts
  // appear as stray non-ASCII characters. Extract the region between the first
  // ┃ that's followed by our content and the next ┃, stripping noise.
  const idx = text.indexOf("┃")
  if (idx === -1) return ""
  // Take everything after the first border appearance
  const after = text.slice(idx)
  // Remove border chars and non-printable noise, collapse whitespace
  return after
    .replace(/┃/g, " ")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

test(
  "keyboard buffering captures all keystrokes during startup",
  async () => {
    const cwd = join(__dirname, "../../..")
    const pty = spawn("bun", ["dev"], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
    })
    ptys.add(pty)

    let output = ""
    pty.onData((data) => {
      output += data
    })

    pty.write(TEST_INPUT)

    await waitFor(() => output.includes("┃"), READY_TIMEOUT)
    // Allow time for the flush to replay buffered bytes and re-render
    await waitFor(() => clean(output).includes(TEST_INPUT), 5000)

    const text = clean(output)
    const field = prompt(text)
    expect(field).toContain(TEST_INPUT)
  },
  STARTUP_TIMEOUT + 10_000,
)
