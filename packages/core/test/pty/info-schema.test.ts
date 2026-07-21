import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Pty } from "@opencode-ai/core/pty"

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

  test("accepts an exit code for retained exited sessions", () => {
    const info = Schema.decodeUnknownSync(Pty.Info)({ ...sample(48012), status: "exited", exitCode: 4 })
    expect(info.exitCode).toBe(4)
  })
})
