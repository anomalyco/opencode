import { EventEmitter } from "node:events"
import { expect, mock, test } from "bun:test"

const calls: string[][] = []
let stdout = ""

mock.module("node:child_process", () => ({
  spawn: (_command: string, args: string[]) => {
    calls.push(args)
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(stdout))
      child.stdout.emit("end")
      child.stderr.emit("end")
      child.emit("close", 0, null)
    })
    return child
  },
}))

mock.module("@lydell/node-pty", () => ({
  spawn: () => {
    throw new Error("unexpected interactive command")
  },
}))

const { resolveWslOpencode } = await import("./runtime")

test("resolves OpenCode from the distro PATH without Windows interop entries", async () => {
  calls.length = 0
  stdout = "/home/alice/.local/bin/opencode\n"

  await expect(resolveWslOpencode("Debian")).resolves.toBe("/home/alice/.local/bin/opencode")
  expect(calls).toEqual([
    [
      "-d",
      "Debian",
      "--",
      "sh",
      "-c",
      'PATH=$(printf "%s" "$PATH" | awk -v RS=: -v ORS=: \'$0 !~ /^\\/mnt\\//\' | sed "s/:$//"); export PATH; command -v opencode || { [ -x "$HOME/.opencode/bin/opencode" ] && printf "%s\\n" "$HOME/.opencode/bin/opencode"; }',
    ],
  ])
})

test("falls back to the fixed OpenCode path when it is absent from PATH", async () => {
  calls.length = 0
  stdout = "/home/alice/.opencode/bin/opencode\n"

  await expect(resolveWslOpencode("Debian")).resolves.toBe("/home/alice/.opencode/bin/opencode")
})
