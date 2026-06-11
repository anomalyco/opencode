import { describe, expect, test } from "bun:test"
import { ShellEnv } from "../../src/shell/env"

describe("shell.env", () => {
  test("formatCommandEnvPrefix uses export for bash", () => {
    expect(ShellEnv.formatCommandEnvPrefix("/bin/bash", { CI: "true", FOO: "bar" })).toBe(
      "export CI=true; export FOO=bar; ",
    )
  })

  test("formatCommandEnvPrefix uses PowerShell syntax for pwsh", () => {
    expect(ShellEnv.formatCommandEnvPrefix("pwsh.exe", { CI: "true" })).toBe("$env:CI=true; ")
  })

  test("stripIncompatibleEnvPrefix removes PowerShell env assignments for bash", () => {
    const command = "$env:CI='true'; $env:DEBIAN_FRONTEND='noninteractive'; git status"
    expect(ShellEnv.stripIncompatibleEnvPrefix(command, "bash.exe")).toBe("git status")
  })

  test("stripIncompatibleEnvPrefix keeps PowerShell prefixes for pwsh", () => {
    const command = "$env:CI='true'; git status"
    expect(ShellEnv.stripIncompatibleEnvPrefix(command, "pwsh.exe")).toBe(command)
  })
})
