import { EventEmitter } from "node:events"
import { expect, mock, test } from "bun:test"

const calls: string[][] = []

mock.module("node:child_process", () => ({
  spawn: (_command: string, args: string[]) => {
    calls.push(args)
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })
    queueMicrotask(() => child.emit("close", 0, null))
    return child
  },
}))

mock.module("@lydell/node-pty", () => ({
  spawn: () => {
    throw new Error("unexpected interactive command")
  },
}))

const { probeWslDistro } = await import("./runtime")

test("probes distro execution through true on PATH", async () => {
  calls.length = 0

  await expect(probeWslDistro("Alpine")).resolves.toMatchObject({
    name: "Alpine",
    canExecute: true,
  })

  expect(calls[0]).toEqual(["-d", "Alpine", "--", "true"])
})
