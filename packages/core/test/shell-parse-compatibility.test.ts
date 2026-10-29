import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { ShellParse } from "../src/shell/parse.js"

describe("portable shell parser compatibility", () => {
const compatibilityCases: Array<[string, string, Record<string, string>, ShellParse.Result]> = [
    ["bash", "echo $((1+1))", {}, { commands: [{ resource: "echo $((1+1))", save: "echo *" }], directories: [] }],
    [
      "bash",
      "echo $((1 + $(printf hidden)))",
      {},
      {
        commands: [
          { resource: "echo $((1 + $(printf hidden)))", save: "echo *" },
          { resource: "printf hidden", save: "printf *" },
        ],
        directories: [],
      },
    ],
    ["bash", "cd ~/project", {}, { commands: [], directories: [path.join(os.homedir(), "project")] }],
    ["bash", "cd src&&cd..", {}, { commands: [{ resource: "cd..", save: "cd.. *" }], directories: ["src"] }],
    [
      "bash",
      "cd src && cd .. && git status",
      {},
      { commands: [{ resource: "git status", save: "git status *" }], directories: ["src", ".."] },
    ],
    ["zsh", "git status", {}, { commands: [{ resource: "git status", save: "git status *" }], directories: [] }],
    ["fish", "git status", {}, { commands: [{ resource: "git status", save: "git status *" }], directories: [] }],
    [
      "bash",
      "git status",
      { BASH_ENV: "/startup" },
      { commands: [{ resource: "git status", save: "git status *" }], directories: [] },
    ],
    [
      "bash",
      "git status",
      { "BASH_FUNC_cd%%": "() { :; }" },
      { commands: [{ resource: "git status", save: "git status *" }], directories: [] },
    ],
    [
      "bash",
      "cd $HOME; pwd",
      { HOME: "/session-home" },
      { commands: [{ resource: "pwd", save: "pwd *" }], directories: [] },
    ],
    ["bash", "cd; pwd", { HOME: "/session-home" }, { commands: [{ resource: "pwd", save: "pwd *" }], directories: [] }],
    [
      "bash",
      'target=/outside; cd "$target"; pwd',
      {},
      { commands: [{ resource: "pwd", save: "pwd *" }], directories: [] },
    ],
    [
      "bash",
      "cd 'src dir' && git status",
      {},
      { commands: [{ resource: "git status", save: "git status *" }], directories: ["src dir"] },
    ],
    ["bash", 'cd "src dir"; cd escaped\\ space', {}, { commands: [], directories: ["src dir", "escaped space"] }],
    [
      "bash",
      "cd '$HOME'; cd '~/outside'",
      {},
      { commands: [], directories: ["$HOME", path.join(os.homedir(), "outside")] },
    ],
    ["bash", 'g""it status', {}, { commands: [{ resource: 'g""it status', save: 'g""it *' }], directories: [] }],
    [
      "bash",
      'npm "run" test',
      {},
      { commands: [{ resource: 'npm "run" test', save: 'npm "run" *' }], directories: [] },
    ],
    ["bash", "git '*'", {}, { commands: [{ resource: "git '*'", save: "git '*' *" }], directories: [] }],
    [
      "bash",
      "FOO=bar git status",
      {},
      { commands: [{ resource: "FOO=bar git status", save: "git status *" }], directories: [] },
    ],
    ["bash", "HOME=/outside; cd; pwd", {}, { commands: [{ resource: "pwd", save: "pwd *" }], directories: [] }],
    ["bash", "CDPATH=/outside cd child", {}, { commands: [], directories: ["child"] }],
    [
      "bash",
      "cd child; pwd",
      { CDPATH: "/outside" },
      { commands: [{ resource: "pwd", save: "pwd *" }], directories: ["child"] },
    ],
    ["bash", "cd /workspace > output", {}, { commands: [], directories: ["/workspace"] }],
    [
      "bash",
      "export X=value; unset X; git status",
      {},
      { commands: [{ resource: "git status", save: "git status *" }], directories: [] },
    ],
    [
      "bash",
      "printf ok && git status > output",
      {},
      {
        commands: [
          { resource: "printf ok", save: "printf *" },
          { resource: "git status", save: "git status *" },
        ],
        directories: [],
      },
    ],
    [
      "bash",
      "printf ok | cat < input > output",
      {},
      {
        commands: [
          { resource: "printf ok", save: "printf *" },
          { resource: "cat", save: "cat *" },
        ],
        directories: [],
      },
    ],
    [
      "bash",
      "cd -- -/../../../etc; pwd",
      {},
      { commands: [{ resource: "pwd", save: "pwd *" }], directories: ["-/../../../etc"] },
    ],
    ["bash", "cd -; pushd; popd; pwd", {}, { commands: [{ resource: "pwd", save: "pwd *" }], directories: [] }],
    [
      "bash",
      "command cd /outside; builtin cd /elsewhere",
      {},
      {
        commands: [
          { resource: "command cd /outside", save: "command *" },
          { resource: "builtin cd /elsewhere", save: "builtin *" },
        ],
        directories: ["/outside", "/elsewhere"],
      },
    ],
    [
      "pwsh",
      "Get-ChildItem | ForEach-Object { Write-Output $_ }",
      {},
      {
        commands: [
          { resource: "Get-ChildItem", save: "Get-ChildItem *" },
          { resource: "ForEach-Object { Write-Output $_ }", save: "ForEach-Object *" },
          { resource: "Write-Output $_", save: "Write-Output *" },
        ],
        directories: [],
      },
    ],
    [
      "pwsh",
      "ForEach-Object { Remove-Item victim }",
      {},
      { commands: [{ resource: "Remove-Item victim", save: "Remove-Item *" }], directories: [] },
    ],
    [
      "pwsh",
      "Set-Location -LiteralPath '../outside'; Get-ChildItem",
      {},
      { commands: [{ resource: "Get-ChildItem", save: "Get-ChildItem *" }], directories: ["../outside"] },
    ],
    ["pwsh", "Set-Location -LiteralPath:/outside", {}, { commands: [], directories: ["/outside"] }],
    ["pwsh", "Set-Location -LiteralPath:'/outside path'", {}, { commands: [], directories: ["/outside path"] }],
    ["pwsh", 'Set-Location -PATH:"../outside path"', {}, { commands: [], directories: ["../outside path"] }],
    [
      "pwsh",
      "Set-Location $HOME; Set-Location $PWD; Set-Location $target",
      { HOME: "/session-home" },
      { commands: [], directories: [process.platform === "win32" ? os.homedir() : "/session-home", "/workspace"] },
    ],
    [
      "pwsh",
      "Set-Item Env:T /outside; Set-Location $env:T",
      { T: "/workspace" },
      { commands: [{ resource: "Set-Item Env:T /outside", save: "Set-Item *" }], directories: ["/workspace"] },
    ],
    [
      "pwsh",
      "sl /outside; Microsoft.PowerShell.Management\\Set-Location /outside",
      {},
      {
        commands: [
          { resource: "sl /outside", save: "sl *" },
          {
            resource: "Microsoft.PowerShell.Management\\Set-Location /outside",
            save: "Microsoft.PowerShell.Management\\Set-Location *",
          },
        ],
        directories: [],
      },
    ],
  ]
  test.each(compatibilityCases)(
    "extracts resources, saved prefixes, and directories: %s %s %j",
    async (shell, command, env, expected) => {
      if (Object.keys(env).length > 0) {
        const child = Bun.spawn({
          cmd: [
            process.execPath,
            "--eval",
            `
          import { Effect } from "effect"
          import { ShellParse } from "./src/shell/parse.ts"
          const command = ${JSON.stringify(command)}
          const shell = ${JSON.stringify(shell)}
          const scanned = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
          const native = await Effect.runPromise(ShellParse.scanPortable(command, shell, "/workspace"))
          console.log(JSON.stringify([scanned, native]))
        `,
          ],
          cwd: `${import.meta.dir}/..`,
          env: { ...process.env, ...env },
          stdout: "pipe",
          stderr: "pipe",
        })
        const [output, error, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect(code, error).toBe(0)
        const [scanned, native] = JSON.parse(output)
        expect(scanned).toEqual(expected)
        expect(native).toEqual(scanned)
        return
      }
      const scanned = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
      expect(scanned).toEqual(expected)
      expect(await Effect.runPromise(ShellParse.scanPortable(command, shell, "/workspace"))).toEqual(scanned)
    },
  )

  test("derives the prefix for long argument lists", async () => {
    const command = `echo ${"x ".repeat(16_000)}`.trimEnd()
    const result = await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace"))
    expect(result).toEqual({ commands: [{ resource: command, save: "echo *" }], directories: [] })
  })

  test("extracts inline PowerShell directory flags with case-insensitive names and quoted values", async () => {
    const result = await Effect.runPromise(
      ShellParse.scanPortable(
        "Set-Location -LITERALPATH:C:\\outside; Set-Location -pAtH:'../other dir'; Set-Location -p:/short; Set-Location -lp /literal; Set-Location -l:/prefix; Set-Location -lit:/litprefix; Set-Location -pat:/patprefix; Set-Location -PSPath:/pspath; Set-Location '-outside'; Set-Location -/../../outside; Set-Location -Path -- -/../../outside2; Set-Location -- -outside2; Set-Location -`outside3; Set-Location \"../`$a/../outside4\"; Set-Location /out`side; Set-Location 'C:\\quoted'",
        "pwsh",
        "/workspace",
      ),
    )
    expect(result).toEqual({
      commands: [],
      directories: [
        "C:\\outside",
        "../other dir",
        "/short",
        "/literal",
        "/prefix",
        "/litprefix",
        "/patprefix",
        "/pspath",
        "-outside",
        "-/../../outside",
        "-/../../outside2",
        "-outside2",
        "-outside3",
        "../$a/../outside4",
        "/outside",
        "C:\\quoted",
      ],
    })
  })

  test("retains statement-head ForEach-Object cmdlet calls when non-scriptblock parameters are present", async () => {
    const result = await Effect.runPromise(
      ShellParse.scanPortable("ForEach-Object -InputObject $proc -MemberName Kill", "pwsh", "/workspace"),
    )
    expect(result).toEqual({
      commands: [{ resource: "ForEach-Object -InputObject $proc -MemberName Kill", save: "ForEach-Object *" }],
      directories: [],
    })
  })
})

describe("scanner behavior on former tree-sitter gaps", () => {
  for (const fixture of [
    {
      name: "omits synthetic command nodes for an assignment with redirection",
      shell: "bash",
      command: "FOO=bar > output",
      expected: { commands: [], directories: [] },
    },
    {
      name: "retains nested executable commands without empty assignment command nodes",
      shell: "bash",
      command: "FOO=$(printf value) > output",
      expected: { commands: [{ resource: "printf value", save: "printf *" }], directories: [] },
    },
    {
      name: "keeps numeric arguments in saved prefixes",
      shell: "bash",
      command: "git 2 status",
      expected: { commands: [{ resource: "git 2 status", save: "git 2 *" }], directories: [] },
    },
    {
      name: "keeps numeric directory names and operator-shaped arguments",
      shell: "bash",
      command: "cd 123; git == value",
      expected: { commands: [{ resource: "git == value", save: "git == *" }], directories: ["123"] },
    },
    {
      name: "preserves substitution source in saved prefixes instead of skipping the argument",
      shell: "bash",
      command: "git $(printf status) diff",
      expected: {
        commands: [
          { resource: "git $(printf status) diff", save: "git $(printf status) *" },
          { resource: "printf status", save: "printf *" },
        ],
        directories: [],
      },
    },
    {
      name: "joins directory line continuations into the resolved path",
      shell: "bash",
      command: "cd before\\\nafter",
      expected: { commands: [], directories: ["beforeafter"] },
    },
    {
      name: "recognizes PowerShell carriage-return separators",
      shell: "pwsh",
      command: "Get-ChildItem\rRemove-Item victim",
      expected: {
        commands: [
          { resource: "Get-ChildItem", save: "Get-ChildItem *" },
          { resource: "Remove-Item victim", save: "Remove-Item *" },
        ],
        directories: [],
      },
    },
    {
      name: "recognizes tab-separated PowerShell commands",
      shell: "pwsh",
      command: "git\tstatus",
      expected: { commands: [{ resource: "git\tstatus", save: "git\tstatus *" }], directories: [] },
    },
    {
      name: "preserves complete PowerShell flag=value resources",
      shell: "pwsh",
      command: "git --flag=value",
      expected: { commands: [{ resource: "git --flag=value", save: "git --flag=value *" }], directories: [] },
    },
    {
      name: "does not split comma-separated PowerShell directory operands",
      shell: "pwsh",
      command: "Set-Location a,b",
      expected: { commands: [], directories: ["a,b"] },
    },
  ]) {
    test(fixture.name, async () => {
      const scanned = await Effect.runPromise(ShellParse.scan(fixture.command, fixture.shell, "/workspace"))
      expect(scanned).toEqual(fixture.expected)
      expect(await Effect.runPromise(ShellParse.scanPortable(fixture.command, fixture.shell, "/workspace"))).toEqual(
        fixture.expected,
      )
    })
  }
})

describe("directory command set", () => {
  test.each(["bash", "zsh", "pwsh"])("retains the shared directory command set: %s", async (shell) => {
    const result = await Effect.runPromise(
      ShellParse.scan(
        "chdir /outside; set-location /elsewhere; push-location /stack; sl .; pop-location",
        shell,
        "/workspace",
      ),
    )
    expect(result).toEqual({
      commands: [
        { resource: "sl .", save: "sl *" },
        { resource: "pop-location", save: "pop-location *" },
      ],
      directories: ["/outside", "/elsewhere", "/stack"],
    })
  })
})
