import { describe, expect, test } from "bun:test"
import { mergeCreatedTerminal, type LocalPTY } from "./terminal-shared"

describe("mergeCreatedTerminal", () => {
  test("returns same array reference when terminal already exists", () => {
    const all: LocalPTY[] = [{ id: "pty-1", title: "Terminal 1", titleNumber: 1, cwd: "/ws" }]
    const next = mergeCreatedTerminal(all, { id: "pty-1", title: "Terminal 1", cwd: "/ws" })
    // Identity check: no new array allocated
    expect(next).toBe(all)
    expect(next).toHaveLength(1)
    // Existing properties preserved unchanged
    expect(next[0]?.titleNumber).toBe(1)
  })

  test("assigns sequential titleNumber when title is not provided", () => {
    const all: LocalPTY[] = [{ id: "pty-1", title: "Terminal 1", titleNumber: 1, cwd: "/ws" }]
    const next = mergeCreatedTerminal(all, { id: "pty-2", cwd: "/ws" })
    expect(next).toHaveLength(2)
    expect(next[1]?.title).toBe("Terminal 2")
    expect(next[1]?.titleNumber).toBe(2)
  })

  test("fills gaps in title numbering", () => {
    const all: LocalPTY[] = [
      { id: "pty-1", title: "Terminal 1", titleNumber: 1, cwd: "/ws" },
      { id: "pty-3", title: "Terminal 3", titleNumber: 3, cwd: "/ws" },
    ]
    const next = mergeCreatedTerminal(all, { id: "pty-new", cwd: "/ws" })
    expect(next).toHaveLength(3)
    expect(next[2]?.titleNumber).toBe(2)
    expect(next[2]?.title).toBe("Terminal 2")
  })
})
