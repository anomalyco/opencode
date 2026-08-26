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
    })
  })

  test("portable scanning preserves supported command resources and directories", async () => {
    const commands = [
      "git status && npm run test -- --watch",
      "echo $(curl evil | sed s/x/y/)",
      "cd /tmp/$USER && git status",
      "if true; then printf yes; else printf no; fi",
      "echo $((1 + 1))",
      "cd ~; cd src&&cd ..; pwd",
    ]

    for (const command of commands) {
      const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable, command).toEqual(legacy)
      expect(await Effect.runPromise(ShellParse.scanPortable(command, "/bin/bash", "/workspace"))).toEqual(portable)
    }
  })

  test("portable scanning exposes heredoc failures instead of falling back", async () => {
    const command = "cat <<'EOF'\nstatic body\nEOF"
    const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
    expect(legacy.commands).toEqual([{ resource: command, save: "cat *" }])
    expect(
      await Effect.runPromise(Effect.result(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))),
    ).toMatchObject({
      _tag: "Failure",
      failure: { message: "Portable shell scanner cannot analyze command: heredoc" },
    })
  })

  test.each(['c"\\d" relative', "'cd' /tmp", "c''d /tmp", "c\\\nd /tmp"])(
    "portable scanning keeps source-shaped command heads under shell authorization: %s",
    async (command) => {
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable.commands.map((item) => item.resource)).toEqual([command])
      expect(portable.directories).toEqual([])
    },
  )

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
  })

  test("does not permission directory changes separately", async () => {
    const result = await Effect.runPromise(ShellParse.scan("cd 'src dir' && git status", "/bin/bash", "/workspace"))
    expect(result).toEqual({
      commands: [{ resource: "git status", save: "git status *" }],
      directories: ["src dir"],
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
