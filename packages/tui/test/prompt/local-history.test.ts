import { describe, expect, test } from "bun:test"
import {
  appendLocalCommandHistory,
  moveLocalCommandHistory,
  MAX_LOCAL_COMMAND_HISTORY,
  MAX_LOCAL_COMMAND_OUTPUT_DISPLAY,
} from "../../src/prompt/local-history"

describe("local command history", () => {
  test("retains a bounded in-memory command and output history", () => {
    const entries = Array.from({ length: MAX_LOCAL_COMMAND_HISTORY + 1 }, (_, index) => ({
      command: `command-${index}`,
      output: "x".repeat(MAX_LOCAL_COMMAND_OUTPUT_DISPLAY + 1),
      failed: false,
    })).reduce(appendLocalCommandHistory, [])

    expect(entries).toHaveLength(MAX_LOCAL_COMMAND_HISTORY)
    expect(entries[0]?.command).toBe("command-1")
    expect(entries.at(-1)?.output).toContain("Output shortened for Local shell history.")
    expect(entries.at(-1)?.output.length).toBeLessThanOrEqual(MAX_LOCAL_COMMAND_OUTPUT_DISPLAY)
  })

  test("navigates commands without touching the persistent prompt history", () => {
    const entries = [
      { command: "pwd", output: "/workspace", failed: false },
      { command: "code .", output: "", failed: false },
    ]

    expect(moveLocalCommandHistory(entries, 0, -1)).toEqual({ command: "code .", index: -1 })
    expect(moveLocalCommandHistory(entries, -1, -1)).toEqual({ command: "pwd", index: -2 })
    expect(moveLocalCommandHistory(entries, -2, 1)).toEqual({ command: "code .", index: -1 })
    expect(moveLocalCommandHistory(entries, -1, 1)).toEqual({ command: "", index: 0 })
  })
})
