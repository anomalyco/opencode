import { Console } from "effect"
import { format } from "node:util"

// Bun makes a piped stdout nonblocking once `process.stdout` is used, and the TUI preload already leaves
// it nonblocking at startup. On a nonblocking pipe Bun's console drops whatever does not fit once the
// pipe is full, so `--completions fish` (~68 KiB) stopped at 65536 bytes. Stream writes queue instead,
// but `process.exit` discards the queue unless the last write has called back. An empty write calls
// back immediately, so the last real write per stream is kept and awaited.
// See https://github.com/anomalyco/opencode/issues/55525
const pending = { stdout: Promise.resolve(), stderr: Promise.resolve() }

function write(stream: keyof typeof pending, args: ReadonlyArray<unknown>) {
  pending[stream] = new Promise((resolve) => process[stream].write(format(...args) + "\n", () => resolve()))
}

export const console: Console.Console = Object.assign(Object.create(globalThis.console), {
  log: (...args: ReadonlyArray<unknown>) => write("stdout", args),
  info: (...args: ReadonlyArray<unknown>) => write("stdout", args),
  debug: (...args: ReadonlyArray<unknown>) => write("stdout", args),
  warn: (...args: ReadonlyArray<unknown>) => write("stderr", args),
  error: (...args: ReadonlyArray<unknown>) => write("stderr", args),
})

export const flush = () => Promise.all([pending.stdout, pending.stderr])

export * as Output from "./output"
