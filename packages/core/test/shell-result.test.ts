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
    expect(ShellResult.interrupted({ info: info("killed"), capture: { output: "partial\n", truncated: false } })).toBe(
      "partial\n\n[full output saved to /tmp/sh_result.out]\n\nCommand interrupted by the user (shell ID: sh_result).",
    )
  })

  test("keeps a truncated tail's own notice", () => {
    const output = "tail\n\n[showing lines 9-10 of 10; full output saved to /tmp/sh_result.out]"
    expect(ShellResult.interrupted({ info: info("killed"), capture: { output, truncated: true } })).toBe(
      `${output}\n\nCommand interrupted by the user (shell ID: sh_result).`,
    )
  })

  test("says once that there was no output, and that a command still stopping is not done", () => {
    expect(
      ShellResult.interrupted({ info: info("running"), capture: { output: "(no output)", truncated: false } }),
    ).toBe(
      "[no output; output file: /tmp/sh_result.out]\n\nCommand interrupted by the user (shell ID: sh_result); it is still being stopped.",
    )
  })
})
