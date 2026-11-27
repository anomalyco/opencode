import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "@opencode/core/shell/parse"

// Nothing here runs a command: every case is only scanned.
const scan = (command: string, shell: string) =>
  Effect.runPromise(ShellParse.scan(command, shell, shell === "pwsh" ? "C:\\work" : "/work")).then(
    (result) => result.rootDelete?.operand,
  )

describe("ShellParse root deletes", () => {
  test.each([
    // #66771: PowerShell ends the string at \", so cmd runs rmdir with \ (the drive root) before the path.
    ["pwsh", '$p = "C:\\Users\\u\\AppData\\Local\\Temp\\repro\\watch_mode"; cmd /c "rmdir /s /q \\"$p\\"" 2>&1', "\\"],
    // #65495: the same split inside a remote command, which ssh joins with spaces.
    ["pwsh", 'ssh host "rd /s /q C:\\Demo\\one & rd /s /q \\"C:\\Demo\\数据集 测试\\" & echo done"', "\\"],
    ["pwsh", "rd /s /q C:\\", "C:\\"],
    ["pwsh", 'Remove-Item -LiteralPath "D:/" -Recurse -Force', "D:/"],
    ["pwsh", 'ri -rec -fo "\\*"', "\\*"],
    ["pwsh", "robocopy C:\\empty C:\\ /MIR", "C:\\"],
    ["pwsh", 'powershell -NoProfile -Command "Remove-Item C:\\ -Recurse"', "C:\\"],
    ["bash", "rm -rf /", "/"],
    ["bash", "cd /tmp && rm -r -- /*", "/*"],
    ["bash", 'bash -c "rm -rf /"', "/"],
    ["bash", "ssh -p 2222 -o BatchMode=yes host 'rm -rf /'", "/"],
  ])("%s: %s deletes %s", async (shell, command, operand) => {
    expect(await scan(command, shell)).toBe(operand)
  })

  test.each([
    ["pwsh", 'cmd /c "rmdir /s /q ""C:\\Users\\u\\watch_mode"""'],
    ["pwsh", 'Remove-Item -LiteralPath "C:\\work\\x" -Recurse -Force'],
    ["pwsh", "rd /s /q C:\\work\\build"],
    // C: is the current directory on C:, not its root.
    ["pwsh", "rd /s /q C:"],
    ["pwsh", "Remove-Item C:\\ -WhatIf"],
    ["pwsh", "robocopy C:\\ C:\\backup /MIR"],
    // A read-only remote command is not flagged for spaces, non-ASCII paths or a split quote.
    ["pwsh", 'ssh host "dir C:\\Demo\\one & dir \\"C:\\Demo\\数据集 测试\\""'],
    ["bash", "rm -rf ./build /tmp/x"],
    ["bash", "ls -la /"],
    ["bash", 'ssh host "rm -rf /tmp/x"'],
  ])("%s: %s deletes no drive root", async (shell, command) => {
    expect(await scan(command, shell)).toBeUndefined()
  })
})
