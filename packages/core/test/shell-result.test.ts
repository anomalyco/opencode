import { describe, expect, test } from "bun:test"
import { ShellResult } from "@opencode/core/shell/result"
import { Shell } from "@opencode/schema/shell"

const info = (status: Shell.Status): Shell.Info => ({
  id: Shell.ID.make("sh_result"),
  status,
  command: "work",
  cwd: "/tmp",
  shell: "/bin/sh",
  file: "/tmp/sh_result.out",
  metadata: {},
  time: { started: 0, completed: 1 },
})

describe("ShellResult.interrupted", () => {
  test("names the output file and the shell even when the output fits", () => {
    expect(
      ShellResult.interrupted({ info: info("killed"), capture: { output: "partial\n", truncated: false } }),
    ).toEqual({
      output: "partial",
      notice: "[full output saved to /tmp/sh_result.out]\n\nCommand interrupted by the user (shell ID: sh_result).",
      message:
        "partial\n\n[full output saved to /tmp/sh_result.out]\n\nCommand interrupted by the user (shell ID: sh_result).",
    })
  })

  test("keeps a truncated tail's own notice", () => {
    const output = "tail\n\n[showing lines 9-10 of 10; full output saved to /tmp/sh_result.out]"
    expect(ShellResult.interrupted({ info: info("killed"), capture: { output, truncated: true } })).toEqual({
      output,
      notice: "Command interrupted by the user (shell ID: sh_result).",
      message: `${output}\n\nCommand interrupted by the user (shell ID: sh_result).`,
    })
  })

  test("says once that there was no output, and that a command still stopping is not done", () => {
    expect(
      ShellResult.interrupted({ info: info("running"), capture: { output: "(no output)", truncated: false } }),
    ).toEqual({
      output: "",
      notice:
        "[no output; output file: /tmp/sh_result.out]\n\nCommand interrupted by the user (shell ID: sh_result); it is still being stopped.",
      message:
        "[no output; output file: /tmp/sh_result.out]\n\nCommand interrupted by the user (shell ID: sh_result); it is still being stopped.",
    })
  })
})

describe("ShellResult.output", () => {
  test("reports a command killed without an exit code or signal of its own", () => {
    const lost = ShellResult.output({
      info: info("killed"),
      capture: { output: "partial\n", truncated: false, killed: "Command was killed: the process daemon stopped" },
    })
    expect(ShellResult.notice(lost)).toBe("Command was killed: the process daemon stopped")
    expect(ShellResult.metadata(lost)).toMatchObject({ killed: true })
  })

  test("keeps a removed command's result unchanged", () => {
    const removed = ShellResult.output({ info: info("killed"), capture: undefined })
    expect(removed).toEqual({ output: ShellResult.unavailable.output, truncated: false })
    expect(ShellResult.notice(removed)).toBeUndefined()
  })
})
