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
      analysis: "complete",
      directoryUnknown: false,
    })
  })

  test("portable scanning never adds permission resources", async () => {
    const commands = [
      "git status && npm run test -- --watch",
      "echo $(curl evil | sed s/x/y/)",
      "cat <<'EOF'\nstatic body\nEOF",
      "cat <<EOF\n$(printf dynamic)\nEOF",
      "cd /tmp/$USER && git status",
      "$COMMAND status",
      "if true; then printf yes; else printf no; fi",
    ]

    for (const command of commands) {
      const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(
        portable.commands.every((item) => legacy.commands.some((candidate) => candidate.resource === item.resource)),
      ).toBe(true)
      expect(portable.directories.every((item) => legacy.directories.includes(item))).toBe(true)
    }
  })

  test("portable scanning authorizes opaque heredocs without inferring directories", async () => {
    const command = "cat <<'EOF'\nstatic body\nEOF"
    const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
    expect(portable).toEqual({
      commands: [{ resource: command, save: command }],
      directories: [],
      analysis: "opaque",
      directoryUnknown: true,
    })
  })

  test.each(["FOO=bar > /tmp/victim", "echo ok; for x in 1; do touch /tmp/victim; done"])(
    "marks effectful opaque Bash input as exact and directory-unknown: %s",
    async (command) => {
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable).toMatchObject({
        analysis: "opaque",
        directoryUnknown: true,
        commands: [{ resource: command, save: command }],
      })
    },
  )

  test("keeps PowerShell carriage-return commands under authorization", async () => {
    const portable = await Effect.runPromise(
      ShellParse.scan("Get-ChildItem\rRemove-Item victim", "pwsh", "C:\\workspace", { portable: true }),
    )
    expect(portable.commands.map((command) => command.resource)).toEqual(["Get-ChildItem", "Remove-Item victim"])
  })

  test.each(["fish", "nu", "cmd.exe", "/custom/shell"])(
    "fails closed for unsupported shell families: %s",
    async (shell) => {
      const command = "echo (/usr/bin/touch /tmp/victim)"
      const portable = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true }))
      expect(portable).toMatchObject({
        analysis: "opaque",
        directoryUnknown: true,
        commands: [{ resource: command, save: command }],
      })
    },
  )

  test.each(['target=/etc; cd "$target"; pwd', "cd -; pwd", "pushd; pwd"])(
    "preserves uncertainty for unresolved directory changes: %s",
    async (command) => {
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable.directoryUnknown).toBe(true)
    },
  )

  test("resolves a zero-argument cd from the invocation environment", async () => {
    const portable = await Effect.runPromise(
      ShellParse.scan("cd; pwd", "/bin/bash", "/workspace", { portable: true, env: { HOME: "/session-home" } }),
    )
    expect(portable.directories).toEqual(["/session-home"])
    expect(portable.directoryUnknown).toBe(false)
  })

  test.each(["'cd' /tmp", "c''d /tmp"])("recognizes quoted directory commands: %s", async (command) => {
    const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
    expect(portable.commands).toEqual([])
    expect(portable.directories).toEqual(["/tmp"])
  })

  test("recognizes a line-spliced directory command", async () => {
    const portable = await Effect.runPromise(
      ShellParse.scan("c\\\nd /tmp", "/bin/bash", "/workspace", { portable: true }),
    )
    expect(portable.commands).toEqual([])
    expect(portable.directories).toEqual(["/tmp"])
    expect(portable.directoryUnknown).toBe(false)
  })

  test("resolves line splices inside directory operands", async () => {
    const portable = await Effect.runPromise(
      ShellParse.scan("cd before\\\nafter", "/bin/bash", "/workspace", { portable: true }),
    )
    expect(portable.directories).toEqual(["beforeafter"])
    expect(portable.directoryUnknown).toBe(false)
  })

  test.each(["command cd /tmp", "builtin cd /tmp"])(
    "keeps wrapped Bash directory commands uncertain: %s",
    async (command) => {
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable.commands).toEqual([])
      expect(portable.directoryUnknown).toBe(true)
    },
  )

  test("keeps redirected directory changes under exact shell authorization", async () => {
    const command = "cd . > victim"
    const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
    expect(portable).toEqual({
      commands: [{ resource: command, save: command }],
      directories: [],
      analysis: "opaque",
      directoryUnknown: true,
    })
  })

  test("does not widen saved permissions across line splices", async () => {
    const portable = await Effect.runPromise(
      ShellParse.scan("rm\\\necho harmless", "/bin/bash", "/workspace", { portable: true }),
    )
    expect(portable.commands).toEqual([{ resource: "rm\\\necho harmless", save: "rm\\\necho *" }])
  })

  test("does not widen saved permissions across escaped leading whitespace", async () => {
    const portable = await Effect.runPromise(
      ShellParse.scan("\\ rm harmless", "/bin/bash", "/workspace", { portable: true }),
    )
    expect(portable.commands).toEqual([{ resource: "\\ rm harmless", save: "\\ rm *" }])
  })

  test("keeps a genuinely different quoted command under shell authorization", async () => {
    const command = 'c"\\d" relative'
    const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
    expect(portable.commands.map((item) => item.resource)).toEqual([command])
    expect(portable.directories).toEqual([])
  })

  test.each(["sl C:\\outside", "Microsoft.PowerShell.Management\\Set-Location C:\\outside"])(
    "recognizes PowerShell location aliases and module-qualified commands: %s",
    async (command) => {
      const portable = await Effect.runPromise(ShellParse.scan(command, "pwsh", "C:\\workspace", { portable: true }))
      expect(portable.commands).toEqual([])
      expect(portable.directories).toEqual(["C:\\outside"])
    },
  )

  test("extracts colon-separated PowerShell path parameters", async () => {
    const portable = await Effect.runPromise(
      ShellParse.scan("Set-Location -LiteralPath:/etc", "pwsh", "C:\\workspace", {
        portable: true,
        env: { HOME: "C:\\workspace" },
      }),
    )
    expect(portable.commands).toEqual([])
    expect(portable.directories).toEqual(["/etc"])
    expect(portable.directoryUnknown).toBe(false)
  })

  test("keeps leading-hyphen Bash directory operands", async () => {
    const portable = await Effect.runPromise(
      ShellParse.scan("cd -- -/../../../etc; cat passwd", "/bin/bash", "/tmp/project", {
        portable: true,
        env: { HOME: "/tmp/project" },
      }),
    )
    expect(portable.directories).toEqual(["-/../../../etc"])
    expect(portable.directoryUnknown).toBe(false)
  })

  test("keeps session CDPATH and sequential directory changes uncertain", async () => {
    const cdpath = await Effect.runPromise(
      ShellParse.scan("cd foo; pwd", "/bin/bash", "/workspace", {
        portable: true,
        env: { HOME: "/home/test", CDPATH: "/outside" },
      }),
    )
    expect(cdpath.directoryUnknown).toBe(true)

    const sequential = await Effect.runPromise(
      ShellParse.scan("cd deep; cd ../../denied; pwd", "/bin/bash", "/workspace", { portable: true }),
    )
    expect(sequential.directoryUnknown).toBe(true)
  })

  test.each([
    ["export H''OME=/etc; cd; cat passwd", "/bin/bash", { HOME: "/workspace" }],
    ["builtin export H''OME=/etc; cd; cat passwd", "/bin/bash", { HOME: "/workspace" }],
    ["command export H''OME=/etc; cd; cat passwd", "/bin/bash", { HOME: "/workspace" }],
    ["command builtin export H''OME=/etc; cd; cat passwd", "/bin/bash", { HOME: "/workspace" }],
    ["Set-Item Env:T /etc; Set-Location $env:T; Get-Content passwd", "pwsh", { HOME: "/workspace", T: "/workspace" }],
  ] as const)("keeps same-invocation directory environment mutation uncertain: %s", async (command, shell, env) => {
    const portable = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true, env }))
    expect(portable.directoryUnknown).toBe(true)
  })

  test.each(["command -v export HOME=/etc; cd", "command -V export HOME=/etc; cd"])(
    "keeps query-only Bash wrappers statically resolved: %s",
    async (command) => {
      const portable = await Effect.runPromise(
        ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true, env: { HOME: "/workspace" } }),
      )
      expect(portable.directories).toEqual(["/workspace"])
      expect(portable.directoryUnknown).toBe(false)
    },
  )

  test.each([
    ["/bin/bash", { HOME: "/workspace", BASH_ENV: "/tmp/hook" }],
    ["/bin/zsh", { HOME: "/tmp/hooks" }],
    ["/bin/ksh", { HOME: "/workspace", ENV: "/tmp/hook" }],
  ] as const)("fails closed for shell startup hooks: %s", async (shell, env) => {
    const command = "echo safe"
    const portable = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true, env }))
    expect(portable).toEqual({
      commands: [{ resource: command, save: command }],
      directories: [],
      analysis: "opaque",
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
  })

  test("does not permission directory changes separately", async () => {
    const result = await Effect.runPromise(ShellParse.scan("cd 'src dir' && git status", "/bin/bash", "/workspace"))
    expect(result).toEqual({
      commands: [{ resource: "git status", save: "git status *" }],
      directories: ["src dir"],
      analysis: "complete",
      directoryUnknown: false,
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
