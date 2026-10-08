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

  test("portable scanning preserves supported command resources and directories", async () => {
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
      const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable, command).toEqual(legacy)
      expect(await Effect.runPromise(ShellParse.scanPortable(command, "/bin/bash", "/workspace"))).toEqual(portable)
    }
  })

  test("portable scanning handles heredocs with the existing permission resource", async () => {
    const command = "cat <<'EOF'\nstatic body\nEOF"
    const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
    expect(legacy.commands).toEqual([{ resource: command, save: "cat *" }])
    expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))).toEqual(
      legacy,
    )
  })

  test.each(['c"\\d" relative', "'cd' /tmp", "c''d /tmp", "c\\\nd /tmp"])(
    "portable scanning keeps source-shaped command heads under shell authorization: %s",
    async (command) => {
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable.commands.map((item) => item.resource)).toEqual([command])
      expect(portable.directories).toEqual([])
    },
  )

  test.each(["declare", "typeset", "export", "readonly", "local", "unset", "unsetenv"])(
    "preserves declaration permission behavior for %s without hiding nested commands",
    async (name) => {
      for (const command of [`${name} X`, `${name} "$(printf X)"; git status`]) {
        const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
        expect(legacy.commands).toEqual(
          command.includes("$(")
            ? [
                { resource: "printf X", save: "printf *" },
                { resource: "git status", save: "git status *" },
              ]
            : [],
        )
        expect(
          await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true })),
        ).toEqual(legacy)
      }

      for (const command of [`"${name}" X`, `FOO=bar ${name} X`, `command ${name} X`, `>${name}.txt ${name} X`]) {
        const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
        expect(legacy.commands).toHaveLength(1)
        expect(
          await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true })),
        ).toEqual(legacy)
      }
    },
  )

  test("declaration filtering retains directory checks inside command substitutions", async () => {
    const command = "export X=$(cd /outside; printf value)"
    const expected = { commands: [{ resource: "printf value", save: "printf *" }], directories: ["/outside"] }
    expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))).toEqual(expected)
    expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))).toEqual(
      expected,
    )
  })

  test("does not treat PowerShell commands as Bash declarations", async () => {
    expect(await Effect.runPromise(ShellParse.scanPortable("export X; unset X", "pwsh", "/workspace"))).toEqual({
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
    expect(backslash.directories).toEqual(process.platform === "win32" ? [path.join(os.homedir(), "src")] : ["~\\src"])

    const powershell = await Effect.runPromise(
      ShellParse.scan('Set-Location "$PWD/src"; Set-Location $PSHOME', "/usr/local/bin/pwsh", "/workspace"),
    )
    expect(powershell.directories).toEqual(["/workspace/src", "/usr/local/bin"])
  })

  test.each([
    ["FOO=bar git status", "FOO=bar git status", "FOO=bar git status *"],
    ["FOO=bar FOO2=baz git status", "FOO=bar FOO2=baz git status", "FOO=bar FOO2=baz git status *"],
    ["FOO= git status", "FOO= git status", "FOO= git status *"],
    ['FOO="two words" git status', 'FOO="two words" git status', 'FOO="two words" git status *'],
    [
      'FOO="two words"\tgit remote add origin x',
      'FOO="two words"\tgit remote add origin x',
      'FOO="two words"\tgit remote add *',
    ],
    ["FOO=bar npm run test", "FOO=bar npm run test", "FOO=bar npm run test *"],
    ["FOO=bar unknowncmd foo", "FOO=bar unknowncmd foo", "FOO=bar unknowncmd *"],
    [">out FOO=bar git status", ">out FOO=bar git status", ">out FOO=bar git status *"],
    ["FOO=bar >out git status", "FOO=bar >out git status", "FOO=bar >out git status *"],
    ["FOO=bar git status >out", "FOO=bar git status >out", "FOO=bar git status *"],
    ["  FOO=bar git status  ", "FOO=bar git status", "FOO=bar git status *"],
    ["FOO='a b' git status", "FOO='a b' git status", "FOO='a b' git status *"],
    ['FOO="a=b" git status', 'FOO="a=b" git status', 'FOO="a=b" git status *'],
  ] as const)("preserves environment prefixes in saved proposals: %s", async (command, resource, save) => {
    for (const portable of [false, true]) {
      const result = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable }))
      expect(result.directories).toEqual([])
      expect(result.commands).toEqual([{ resource, save }])
    }
  })

  test.each([
    [
      "echo 😀; FOO=你好 git status",
      [
        { resource: "echo 😀", save: "echo *" },
        { resource: "FOO=你好 git status", save: "FOO=你好 git status *" },
      ],
    ],
    [
      "echo $(FOO=bar git status)",
      [
        { resource: "echo $(FOO=bar git status)", save: "echo *" },
        { resource: "FOO=bar git status", save: "FOO=bar git status *" },
      ],
    ],
    [
      "if true; then FOO=bar git status; fi",
      [
        { resource: "true", save: "true *" },
        { resource: "FOO=bar git status", save: "FOO=bar git status *" },
      ],
    ],
    [
      "FOO=bar git status && printf hello",
      [
        { resource: "FOO=bar git status", save: "FOO=bar git status *" },
        { resource: "printf hello", save: "printf *" },
      ],
    ],
  ] as const)("preserves prefixes across compound commands: %s", async (command, expected) => {
    for (const portable of [false, true]) {
      expect(
        (await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable }))).commands,
      ).toEqual([...expected])
    }
  })

  test.each([
    "FOO='a*b' git status",
    'FOO="a?b" git status',
    "FOO=a\\b git status",
    ">out* FOO=bar git status",
    "FOO=bar >out* git status",
  ] as const)("omits only the proposal when the preserved head is not literally representable: %s", async (command) => {
    for (const portable of [false, true]) {
      const result = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable }))
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0]?.resource).toBe(command)
      expect(result.commands[0]?.save).toBeUndefined()
    }
  })

  test("retains safe sibling proposals alongside an omitted unsafe prefix", async () => {
    const command = "FOO='a*b' git status && printf hello"
    for (const portable of [false, true]) {
      const result = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable }))
      expect(result.commands.map((item) => item.resource)).toEqual(["FOO='a*b' git status", "printf hello"])
      expect(result.commands[0]?.save).toBeUndefined()
      expect(result.commands[1]).toEqual({ resource: "printf hello", save: "printf *" })
    }
  })

  test.each(["FOO=bar", "FOO=bar BAZ=qux"] as const)("never proposes assignment-only rules: %s", async (command) => {
    for (const portable of [false, true]) {
      expect(
        (await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable }))).commands,
      ).toEqual([])
    }
  })

  test("documents the inherited empty-executable divergence without losing authorization", async () => {
    const command = "FOO=bar >out"
    const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
    expect(legacy.commands).toEqual([{ resource: command }])
    expect(legacy.commands[0]?.save).toBeUndefined()
    expect(
      (await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))).commands,
    ).toEqual([])
  })

  test.each([
    ['FOO="a*b" printf hello ${X', undefined],
    ["FOO=bar printf hello ${X", "FOO=bar printf *"],
  ] as const)(
    "malformed env-prefixed commands never erase the head into an executable-only grant: %s",
    async (command, save) => {
      expect((await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))).commands).toEqual(
        save === undefined ? [{ resource: command }] : [{ resource: command, save }],
      )
    },
  )

  test.each([">out printf hello", ">out* printf hello"] as const)(
    "preserves baseline unprefixed behavior for leading redirects: %s",
    async (command) => {
      for (const portable of [false, true]) {
        expect(
          (await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable }))).commands,
        ).toEqual([{ resource: command, save: "printf *" }])
      }
    },
  )
})
