import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Pty } from "../../src/pty"

// Windows ConPTY (via @lydell/node-pty >= 1.2.0-beta.12) assigns the child pid
// asynchronously: `proc.pid` reads back as 0 at the synchronous spawn point and
// only resolves to the real pid a tick later. `Pty.create` snapshots `proc.pid`
// while building `Info`, so `Info.pid` legitimately carries 0 right after spawn.
// `Pty.Info` must be able to represent that, otherwise every `pty.create` on
// Windows fails to encode/decode and the terminal feature is unusable.
const sample = (pid: number) => ({
  id: "pty_01J5Y5H0AH4Q4NXJ6P4C3P5V2K",
  title: "demo",
  command: "cmd.exe",
  args: [],
  cwd: "C:\\",
  status: "running",
  pid,
})

describe("Pty.Info", () => {
  test("accepts pid 0 (Windows ConPTY assigns the pid asynchronously)", () => {
    expect(Schema.decodeUnknownSync(Pty.Info)(sample(0)).pid).toBe(0)
  })

  test("accepts a positive pid", () => {
    expect(Schema.decodeUnknownSync(Pty.Info)(sample(48012)).pid).toBe(48012)
  })

  test("rejects a negative pid", () => {
    expect(() => Schema.decodeUnknownSync(Pty.Info)(sample(-1))).toThrow()
  })
})
