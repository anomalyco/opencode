import { describe, expect, test } from "bun:test"
import { mergeCreatedTerminal, type LocalPTY } from "./terminal"

describe("mergeCreatedTerminal", () => {
  test("adds missing terminal from created event", () => {
    const all: LocalPTY[] = []
    const next = mergeCreatedTerminal(all, { id: "pty-1", title: "Terminal 1", cwd: "/ws" })
    expect(next).toHaveLength(1)
    expect(next[0]?.id).toBe("pty-1")
    expect(next[0]?.title).toBe("Terminal 1")
    expect(next[0]?.cwd).toBe("/ws")
  })

  test("does not duplicate existing terminal", () => {
    const all: LocalPTY[] = [{ id: "pty-1", title: "Terminal 1", titleNumber: 1, cwd: "/ws" }]
    const next = mergeCreatedTerminal(all, { id: "pty-1", title: "Terminal 1", cwd: "/ws" })
    expect(next).toHaveLength(1)
  })
})
