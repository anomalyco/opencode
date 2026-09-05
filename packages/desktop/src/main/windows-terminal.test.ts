import { describe, expect, test } from "bun:test"
import {
  buildPowerShellLocationCommand,
  encodePowerShellCommand,
  isPowerShellApp,
} from "./windows-terminal"

describe("isPowerShellApp", () => {
  test("detects bare powershell names", () => {
    expect(isPowerShellApp("powershell")).toBe(true)
    expect(isPowerShellApp("pwsh")).toBe(true)
  })

  test("detects powershell executable names", () => {
    expect(isPowerShellApp("powershell.exe")).toBe(true)
    expect(isPowerShellApp("pwsh.exe")).toBe(true)
  })

  test("detects resolved full paths", () => {
    expect(isPowerShellApp("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(true)
    expect(isPowerShellApp("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(true)
  })

  test("is case-insensitive", () => {
    expect(isPowerShellApp("PowerShell.EXE")).toBe(true)
    expect(isPowerShellApp("PWSH")).toBe(true)
  })

  test("rejects other executables", () => {
    expect(isPowerShellApp("cmd.exe")).toBe(false)
    expect(isPowerShellApp("code")).toBe(false)
    expect(isPowerShellApp("C:\\Program Files\\Microsoft VS Code\\Code.exe")).toBe(false)
  })
})

describe("buildPowerShellLocationCommand", () => {
  test("sets the literal working directory", () => {
    expect(buildPowerShellLocationCommand("C:\\Projects\\demo")).toBe(
      "Set-Location -LiteralPath 'C:\\Projects\\demo'",
    )
  })

  test("escapes single quotes by doubling them", () => {
    expect(buildPowerShellLocationCommand("C:\\Users\\owner's\\project")).toBe(
      "Set-Location -LiteralPath 'C:\\Users\\owner''s\\project'",
    )
  })

  test("keeps non-ascii paths intact", () => {
    expect(buildPowerShellLocationCommand("C:\\Users\\山田\\プロジェクト")).toBe(
      "Set-Location -LiteralPath 'C:\\Users\\山田\\プロジェクト'",
    )
  })
})

describe("encodePowerShellCommand", () => {
  test("round-trips through utf-16le base64", () => {
    const command = "Set-Location -LiteralPath 'C:\\Projects\\path with spaces'"
    const decoded = Buffer.from(encodePowerShellCommand(command), "base64").toString("utf16le")
    expect(decoded).toBe(command)
  })

  test("contains only cmd-safe base64 characters", () => {
    const encoded = encodePowerShellCommand("Set-Location -LiteralPath 'C:\\100% & done; `more' \"$x\"")
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  test("round-trips non-ascii paths", () => {
    const command = buildPowerShellLocationCommand("C:\\Users\\山田\\プロジェクト")
    const decoded = Buffer.from(encodePowerShellCommand(command), "base64").toString("utf16le")
    expect(decoded).toBe(command)
  })
})
