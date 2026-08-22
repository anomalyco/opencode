import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

describe("ShellScan structural mutation closure", () => {
  test.each([
    "$COMMAND status",
    "${COMMAND} status",
    '"$COMMAND" status',
    "$(printf git) status",
    "`printf git` status",
    'printf "unterminated',
    "printf ok &&",
    "| printf ok",
    "printf ok >",
  ])("keeps unknowable or malformed Bash input opaque: %s", (source) => {
    expect(ShellScan.scan(source).kind).toBe("opaque")
  })

  test.each([
    "$Command status",
    "${Command} status",
    "& $Command status",
    "Write-Output ok`",
    'Write-Output "unterminated',
    "Get-ChildItem |",
  ])("keeps unknowable or malformed PowerShell input opaque: %s", (source) => {
    expect(ShellScan.scanPowerShell(source).kind).toBe("opaque")
  })
})
