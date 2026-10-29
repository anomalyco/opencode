import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { ShellParse } from "@opencode/core/shell/parse"

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

  test("rejects malformed syntax with an explicit scanner error", async () => {
    const malformed = await Effect.runPromiseExit(ShellParse.scan('echo "', "/bin/bash", "/workspace"))
    expect(malformed).toMatchObject({
      _tag: "Failure",
      cause: {
        reasons: [
          {
            _tag: "Fail",
            error: { message: expect.stringContaining("Portable shell scanner cannot analyze command") },
          },
        ],
      },
    })
  })

  test("preserves command resources and directories across compound forms", async () => {
    const commands = [
      "git status && npm run test -- --watch",
      "echo $(curl evil | sed s/x/y/)",
      "cd /tmp/$USER && git status",
      "if true; then printf yes; else printf no; fi",
      "if true; then export X=$(printf value); unset X; fi",
      "if export X=$(printf value); then printf done; fi",
      "export X=value >$(printf output)",
      "echo $((1 + 1))",
      "cd ~; cd src&&cd ..; pwd",
    ]

    for (const command of commands) {
      const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
      expect(await Effect.runPromise(ShellParse.scanPortable(command, "/bin/bash", "/workspace"))).toEqual(scanned)
    }
  })

  test("handles heredocs with the command permission resource", async () => {
    const command = "cat <<'EOF'\nstatic body\nEOF"
    const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
    expect(scanned).toEqual({
      commands: [{ resource: command, save: "cat *" }],
      directories: [],
    })
  })

  test.each(['c"\\d" relative', "'cd' /tmp", "c''d /tmp", "c\\\nd /tmp"])(
    "keeps source-shaped command heads under shell authorization: %s",
    async (command) => {
      const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
      expect(scanned.commands.map((item) => item.resource)).toEqual([command])
      expect(scanned.directories).toEqual([])
    },
  )

  test.each(["declare", "typeset", "export", "readonly", "local", "unset", "unsetenv"])(
    "preserves declaration permission behavior for %s without hiding nested commands",
    async (name) => {
      for (const command of [`${name} X`, `${name} "$(printf X)"; git status`]) {
        const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
        expect(scanned.commands).toEqual(
          command.includes("$(")
            ? [
                { resource: "printf X", save: "printf *" },
                { resource: "git status", save: "git status *" },
              ]
            : [],
        )
      }

      for (const command of [`"${name}" X`, `FOO=bar ${name} X`, `command ${name} X`, `>${name}.txt ${name} X`]) {
        const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
        expect(scanned.commands).toHaveLength(1)
      }
    },
  )

  test("declaration filtering retains directory checks inside command substitutions", async () => {
    const command = "export X=$(cd /outside; printf value)"
    const expected = { commands: [{ resource: "printf value", save: "printf *" }], directories: ["/outside"] }
    expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))).toEqual(expected)
  })

  test("does not treat PowerShell commands as Bash declarations", async () => {
    expect(await Effect.runPromise(ShellParse.scan("export X; unset X", "pwsh", "/workspace"))).toEqual({
      commands: [
        { resource: "export X", save: "export *" },
        { resource: "unset X", save: "unset *" },
      ],
      directories: [],
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
  })

  test("does not permission directory changes separately", async () => {
    const result = await Effect.runPromise(ShellParse.scan("cd 'src dir' && git status", "/bin/bash", "/workspace"))
    expect(result).toEqual({
      commands: [{ resource: "git status", save: "git status *" }],
      directories: ["src dir"],
    })
  })

  test("extracts static directory targets across escapes, end-of-options, literal dollars, and precommands", async () => {
    const escaped = await Effect.runPromise(
      ShellParse.scan(
        'cd .\\./outside && cd escaped\\ space && cd \'../$literal\' && cd "../\\$literal2" && cd before\\\nafter',
        "/bin/bash",
        "/workspace",
      ),
    )
    expect(escaped.directories).toEqual(["../outside", "escaped space", "../$literal", "../$literal2", "beforeafter"])

    const dashArgs = await Effect.runPromise(
      ShellParse.scan("cd -P /first && cd -- -/../../../etc && cd -", "/bin/bash", "/workspace"),
    )
    expect(dashArgs.directories).toEqual(["/first", "-/../../../etc"])

    const wrapped = await Effect.runPromise(
      ShellParse.scan("command cd /outside; builtin cd /elsewhere; command -v cd", "/bin/bash", "/workspace"),
    )
    expect(wrapped).toEqual({
      commands: [
        { resource: "command cd /outside", save: "command *" },
        { resource: "builtin cd /elsewhere", save: "builtin *" },
        { resource: "command -v cd", save: "command *" },
      ],
      directories: ["/outside", "/elsewhere"],
    })

    if (process.platform !== "win32") {
      const rootHome = await Effect.runPromise(
        ShellParse.scan("cd ~root/secret && cd '~root'", "/bin/bash", "/workspace"),
      )
      expect(rootHome.directories).toEqual([
        process.platform === "darwin" ? "/var/root/secret" : "/root/secret",
        "~root",
      ])
    }
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

    const backslash = await Effect.runPromise(ShellParse.scan("cd '~\\src'", "/bin/bash", "/workspace"))
    expect(backslash.directories).toEqual(
      process.platform === "win32" ? [path.join(os.homedir(), "src")] : ["~\\src"],
    )

    const powershell = await Effect.runPromise(
      ShellParse.scan('Set-Location "$PWD/src"; Set-Location $PSHOME', "/usr/local/bin/pwsh", "/workspace"),
    )
    expect(powershell.directories).toEqual(["/workspace/src", "/usr/local/bin"])
  })
})
