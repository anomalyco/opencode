import { describe, expect, test } from "bun:test"
import { ShellResult } from "@opencode/core/shell/result"
import { Shell } from "@opencode/schema/shell"

const info = (status: Shell.Status, extra: Partial<Shell.Info> = {}): Shell.Info => ({
  id: Shell.ID.make("sh_result"),
  status,
  command: "work",
  cwd: "/tmp",
  shell: "/bin/sh",
  file: "/tmp/sh_result.out",
  metadata: {},
  time: { started: 0, completed: 1 },
  ...extra,
})
const capture = { output: "partial\n", truncated: false, lines: { shown: 1, total: 1 } }

describe("ShellResult", () => {
  test("reports a command killed without a signal of its own", () => {
    const killed = ShellResult.output({ info: info("killed"), capture })
    expect(killed).toMatchObject({ killed: "Command was killed" })
    expect(ShellResult.notice(killed)).toBe("Command was killed")
    expect(ShellResult.metadata(killed)).toMatchObject({ killed: true })

    const lost = ShellResult.output({
      info: info("killed"),
      capture: { ...capture, killed: "Command was killed: the process daemon stopped" },
    })
    expect(ShellResult.notice(lost)).toBe("Command was killed: the process daemon stopped")
  })

  test("keeps a removed command's result unchanged", () => {
    const removed = ShellResult.output({ info: info("killed"), capture: undefined })
    expect(removed).toEqual({ output: ShellResult.unavailable.output, truncated: false })
    expect(ShellResult.notice(removed)).toBeUndefined()
  })

  test("an interrupted result says it was interrupted, not also that it was killed", () => {
    const result = ShellResult.interrupted({ info: info("killed"), capture })
    expect(result).not.toHaveProperty("killed")
    expect(ShellResult.notice(result)).toBeUndefined()
    expect(result.output).toBe(
      "partial\n\n[showing lines 1-1 of 1; full output saved to /tmp/sh_result.out]\n\nCommand interrupted by the user (shell ID: sh_result).",
    )
  })

  test("an interrupted command without output says so once", () => {
    const result = ShellResult.interrupted({
      info: info("killed"),
      capture: { output: "(no output)", truncated: false, lines: { shown: 0, total: 0 } },
    })
    expect(result.output).toBe(
      "[no output; output file: /tmp/sh_result.out]\n\nCommand interrupted by the user (shell ID: sh_result).",
    )
  })
})
