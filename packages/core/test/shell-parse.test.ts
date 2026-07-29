import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "@opencode-ai/core/shell/parse"

describe("ShellParse", () => {
  test("splits bash commands and derives reusable prefixes", async () => {
    const result = await Effect.runPromise(
      ShellParse.permissions("git status && npm run test -- --watch", "/bin/bash"),
    )
    expect(result).toEqual([
      { resource: "git status", save: "git status *" },
      { resource: "npm run test -- --watch", save: "npm run test *" },
    ])
  })

  test("splits PowerShell commands case-insensitively", async () => {
    const result = await Effect.runPromise(
      ShellParse.permissions("Get-ChildItem; Write-Output 'done'", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"),
    )
    expect(result).toEqual([
      { resource: "Get-ChildItem", save: "Get-ChildItem *" },
      { resource: "Write-Output 'done'", save: "Write-Output *" },
    ])
  })

  test("does not permission directory changes separately", async () => {
    const result = await Effect.runPromise(ShellParse.permissions("cd src && git status", "/bin/bash"))
    expect(result).toEqual([{ resource: "git status", save: "git status *" }])
  })
})
