import { describe, expect, test } from "bun:test"
import {
  formatTerminalTitle,
  resolveTerminalTitleStatus,
  truncateTerminalTitleName,
} from "../../src/util/terminal-title"

describe("util.terminal-title", () => {
  test("priority is attention over busy over idle", () => {
    expect(
      resolveTerminalTitleStatus({
        sessionStatus: { type: "busy" },
        questions: [{ id: "q1" }],
      }),
    ).toBe("attention")
    expect(
      resolveTerminalTitleStatus({
        sessionStatus: { type: "retry" },
        permissions: [{ id: "p1" }],
      }),
    ).toBe("attention")
    expect(resolveTerminalTitleStatus({ sessionStatus: { type: "busy" } })).toBe("busy")
    expect(resolveTerminalTitleStatus({ sessionStatus: { type: "retry" } })).toBe("busy")
    expect(resolveTerminalTitleStatus({ sessionStatus: { type: "idle" } })).toBe("idle")
    expect(resolveTerminalTitleStatus({})).toBe("idle")
  })

  test("formats default and branded titles with status prefixes", () => {
    expect(formatTerminalTitle({ status: "idle", name: "KanCode" })).toBe("KanCode")
    expect(formatTerminalTitle({ status: "busy", name: "KanCode" })).toBe("* KanCode")
    expect(formatTerminalTitle({ status: "attention", name: "KanCode" })).toBe("? KanCode")
    expect(formatTerminalTitle({ status: "idle", name: "My session", branded: true })).toBe("KC | My session")
    expect(formatTerminalTitle({ status: "busy", name: "My session", branded: true })).toBe("* KC | My session")
    expect(formatTerminalTitle({ status: "attention", name: "My session", branded: true })).toBe("? KC | My session")
  })

  test("truncates long names to about 40 characters", () => {
    const long = "a".repeat(50)
    expect(truncateTerminalTitleName(long)).toBe("a".repeat(37) + "...")
    expect(truncateTerminalTitleName("short")).toBe("short")
  })
})
