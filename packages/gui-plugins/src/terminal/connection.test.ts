import { describe, expect, test } from "bun:test"
import { persistentPtyFrame } from "@opencode/client/solid"
import { terminalConnection, type TerminalFailure } from "./connection"

const info = {
  id: "pty_1",
  title: "zsh",
  command: "/bin/zsh",
  args: [],
  cwd: "/repo",
  status: "running",
  pid: 42,
  sessionID: "ses_1",
  foregroundProcess: null,
  size: { cols: 80, rows: 24 },
  output: { head: 0, tail: 128 },
}

const attached = (fields: { inputProtocol?: number } = {}) =>
  JSON.stringify({
    type: "attached",
    inputProtocol: 1,
    info,
    role: "controller",
    generation: 1,
    replay: { requestedOffset: 128, availableOffset: 0, endOffset: 128, truncated: false },
    ...fields,
  })

const replayComplete = JSON.stringify({ type: "replay_complete", endOffset: 128 })

const encode = (text: string) => new TextEncoder().encode(text)

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// A terminal that finishes each write only when the test says so, like ghostty-web finishing on the next frame.
function setup(options: { reply?: string } = {}) {
  const log: string[] = []
  const sent: Uint8Array[] = []
  const failures: TerminalFailure[] = []
  const pending: VoidFunction[] = []

  const connection = terminalConnection({
    attachmentID: "attachment-1",
    write: (data, done) => {
      log.push(`write ${new TextDecoder().decode(data)}`)

      if (options.reply) connection.input(options.reply)
      pending.push(done)
    },
    resize: (size) => log.push(`resize ${size.cols}x${size.rows}`),
    send: (frame) => sent.push(frame),
    fail: (failure) => failures.push(failure),
  })

  const drain = async () => {
    await settle()

    while (pending.length) {
      pending.shift()?.()
      await settle()
    }
  }

  return { connection, log, sent, failures, drain }
}

describe("terminalConnection", () => {
  test("writes output received before a resize at the old size, then resets to the resize checkpoint", async () => {
    const terminal = setup()
    terminal.connection.restore({ size: { cols: 80, rows: 24 }, checkpoint: btoa("restored") })
    terminal.connection.message(attached())
    terminal.connection.output(encode("before"))
    terminal.connection.message(
      JSON.stringify({ type: "resized", cols: 100, rows: 30, generation: 2, checkpoint: btoa("checkpoint") }),
    )
    terminal.connection.output(encode(" after"))
    await terminal.drain()

    expect(terminal.log).toEqual([
      "resize 80x24",
      "write restored",
      "resize 80x24",
      "write before",
      "resize 100x30",
      "write \x1bccheckpoint after",
    ])
  })

  test("holds input until the replay is written, then sends it at the pane's size", async () => {
    const terminal = setup()
    terminal.connection.size({ cols: 120, rows: 40 })
    terminal.connection.restore({ size: { cols: 80, rows: 24 }, checkpoint: btoa("restored") })
    terminal.connection.message(attached())
    terminal.connection.input("ls\r")
    terminal.connection.output(encode("replayed"))
    terminal.connection.message(replayComplete)
    await settle()

    expect(terminal.sent).toEqual([])

    await terminal.drain()

    expect(terminal.sent).toEqual([persistentPtyFrame({ cols: 120, rows: 40 }, encode("ls\r"))])
  })

  test("drops replies the terminal makes while writing output", async () => {
    const terminal = setup({ reply: "\x1b[0n" })
    terminal.connection.size({ cols: 120, rows: 40 })
    terminal.connection.restore({ size: { cols: 80, rows: 24 }, checkpoint: btoa("\x1b[5n") })
    terminal.connection.message(attached())
    terminal.connection.message(replayComplete)
    await terminal.drain()
    terminal.connection.output(encode("\x1b[5n"))
    await terminal.drain()

    expect(terminal.sent).toEqual([persistentPtyFrame({ cols: 120, rows: 40 })])

    terminal.connection.input("a")

    expect(terminal.sent).toEqual([
      persistentPtyFrame({ cols: 120, rows: 40 }),
      persistentPtyFrame({ cols: 120, rows: 40 }, encode("a")),
    ])
  })

  test("stops sending its size once another client takes control, until the user interacts again", async () => {
    const terminal = setup()
    terminal.connection.size({ cols: 120, rows: 40 })
    terminal.connection.restore({ size: { cols: 80, rows: 24 }, checkpoint: btoa("restored") })
    terminal.connection.message(attached())
    terminal.connection.message(replayComplete)
    await terminal.drain()
    terminal.connection.message(
      JSON.stringify({ type: "controller_changed", attachmentID: "attachment-2", generation: 2 }),
    )
    terminal.connection.size({ cols: 100, rows: 30 })

    expect(terminal.sent).toEqual([persistentPtyFrame({ cols: 120, rows: 40 })])

    terminal.connection.interact()

    expect(terminal.sent).toEqual([
      persistentPtyFrame({ cols: 120, rows: 40 }),
      persistentPtyFrame({ cols: 100, rows: 30 }),
    ])
  })

  test("reports a disconnect when the socket closes, but not after the shell exited", () => {
    const open = setup()
    open.connection.message(attached())
    open.connection.close()

    expect(open.failures).toEqual(["disconnected"])

    const exited = setup()
    exited.connection.message(attached())
    exited.connection.message(JSON.stringify({ type: "exited", exitCode: 0, finalOffset: 256 }))
    exited.connection.close()

    expect(exited.failures).toEqual([])
  })

  test("reports a server that does not speak input protocol 1 as out of date", () => {
    const terminal = setup()
    terminal.connection.message(attached({ inputProtocol: undefined }))

    expect(terminal.failures).toEqual(["outdated"])
  })
})
