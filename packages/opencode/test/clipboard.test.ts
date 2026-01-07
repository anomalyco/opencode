import { describe, expect, it } from "bun:test"
import { escapePowerShellValue } from "../src/cli/cmd/tui/util/clipboard"

describe("escapePowerShellValue", () => {
  it("escapes backticks and double quotes for PowerShell", () => {
    const input = 'back`tick"quote'
    const escaped = escapePowerShellValue(input)
    expect(escaped).toBe('back``tick""quote')
  })
})
