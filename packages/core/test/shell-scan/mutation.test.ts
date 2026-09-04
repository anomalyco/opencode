import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

describe("ShellScan structural mutation closure", () => {
  test.each(['printf "unterminated', "printf ok &&", "| printf ok", "printf ok >"])(
    "keeps malformed Bash input opaque: %s",
    (source) => {
      expect(ShellScan.scan(source).kind).toBe("opaque")
    },
  )

  test.each(["Write-Output ok`", 'Write-Output "unterminated', "Get-ChildItem |"])(
    "keeps incomplete PowerShell input opaque: %s",
    (source) => {
      expect(ShellScan.scanPowerShell(source).kind).toBe("opaque")
    },
  )
})
