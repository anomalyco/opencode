import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../src/shell/parse.js"

describe("portable shell parser compatibility", () => {
  test.each([
    ["bash", "echo $((1+1))", {}],
    ["bash", "echo $((1 + $(printf hidden)))", {}],
    ["bash", "cd ~/project", {}],
    ["bash", "cd src&&cd..", {}],
    ["bash", "cd src && cd .. && git status", {}],
    ["zsh", "git status", {}],
    ["fish", "git status", {}],
    ["bash", "git status", { BASH_ENV: "/startup" }],
    ["bash", "git status", { "BASH_FUNC_cd%%": "() { :; }" }],
    ["bash", "cd $HOME; pwd", { HOME: "/session-home" }],
    ["bash", "cd; pwd", { HOME: "/session-home" }],
    ["bash", 'target=/outside; cd "$target"; pwd', {}],
    ["bash", "cd 'src dir' && git status", {}],
    ["bash", 'cd "src dir"; cd escaped\\ space', {}],
    ["bash", "cd '$HOME'; cd '~/outside'", {}],
    ["bash", 'g""it status', {}],
    ["bash", 'npm "run" test', {}],
    ["bash", "git '*'", {}],
    ["bash", "FOO=bar git status", {}],
    ["bash", "HOME=/outside; cd; pwd", {}],
    ["bash", "CDPATH=/outside cd child", {}],
    ["bash", "cd child; pwd", { CDPATH: "/outside" }],
    ["bash", "cd /workspace > output", {}],
    ["bash", "export X=value; unset X; git status", {}],
    ["bash", "printf ok && git status > output", {}],
    ["bash", "printf ok | cat < input > output", {}],
    ["bash", "cd -- -/../../../etc; pwd", {}],
    ["bash", "cd -; pushd; popd; pwd", {}],
    ["bash", "command cd /outside; builtin cd /elsewhere", {}],
    ["pwsh", "Get-ChildItem | ForEach-Object { Write-Output $_ }", {}],
    ["pwsh", "ForEach-Object { Remove-Item victim }", {}],
    ["pwsh", "Set-Location -LiteralPath '../outside'; Get-ChildItem", {}],
    ["pwsh", "Set-Location -LiteralPath:/outside", {}],
    ["pwsh", "Set-Location -LiteralPath:'/outside path'", {}],
    ["pwsh", 'Set-Location -PATH:"../outside path"', {}],
    ["pwsh", "Set-Location $HOME; Set-Location $PWD; Set-Location $target", { HOME: "/session-home" }],
    ["pwsh", "Set-Item Env:T /outside; Set-Location $env:T", { T: "/workspace" }],
    ["pwsh", "sl /outside; Microsoft.PowerShell.Management\\Set-Location /outside", {}],
  ] as const)(
    "matches supported legacy resources, saved prefixes, and directories natively: %s %s %j",
    async (shell, command, env) => {
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
          const legacy = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
          const portable = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true }))
          const native = await Effect.runPromise(ShellParse.scanPortable(command, shell, "/workspace"))
          console.log(JSON.stringify([legacy, portable, native]))
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
        const [legacy, portable, native] = JSON.parse(output)
        expect(portable).toEqual(legacy)
        expect(native).toEqual(legacy)
        return
      }
      const legacy = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
      const portable = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true }))
      expect(portable).toEqual(legacy)
      expect(await Effect.runPromise(ShellParse.scanPortable(command, shell, "/workspace"))).toEqual(legacy)
    },
  )

  test("derives the legacy prefix for long argument lists", async () => {
    const command = `echo ${"x ".repeat(16_000)}`.trimEnd()
    const result = await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace", { portable: true }))
    expect(result).toEqual({ commands: [{ resource: command, save: "echo *" }], directories: [] })
  })

  test("extracts inline PowerShell directory flags with case-insensitive names and quoted values", async () => {
    const result = await Effect.runPromise(
      ShellParse.scanPortable(
        "Set-Location -LITERALPATH:C:\\outside; Set-Location -pAtH:'../other dir'",
        "pwsh",
        "/workspace",
      ),
    )
    expect(result).toEqual({ commands: [], directories: ["C:\\outside", "../other dir"] })
  })
})

describe("current native and legacy parity gaps", () => {
  // These are observed parser gaps, not permission-policy changes that must be preserved.
  for (const fixture of [
    {
      name: "native omits the legacy empty command-name node for an assignment with redirection",
      shell: "bash",
      command: "FOO=bar > output",
      legacy: { commands: [{ resource: "FOO=bar > output", save: " *" }], directories: [] },
      native: { commands: [], directories: [] },
    },
    {
      name: "native retains nested executable commands without the legacy empty assignment command-name node",
      shell: "bash",
      command: "FOO=$(printf value) > output",
      legacy: {
        commands: [
          { resource: "FOO=$(printf value) > output", save: " *" },
          { resource: "printf value", save: "printf *" },
        ],
        directories: [],
      },
      native: { commands: [{ resource: "printf value", save: "printf *" }], directories: [] },
    },
    {
      name: "native keeps numeric arguments in saved prefixes",
      shell: "bash",
      command: "git 2 status",
      legacy: { commands: [{ resource: "git 2 status", save: "git status *" }], directories: [] },
      native: { commands: [{ resource: "git 2 status", save: "git 2 *" }], directories: [] },
    },
    {
      name: "native keeps numeric directory names and operator-shaped arguments",
      shell: "bash",
      command: "cd 123; git == value",
      legacy: { commands: [{ resource: "git == value", save: "git value *" }], directories: [] },
      native: { commands: [{ resource: "git == value", save: "git == *" }], directories: ["123"] },
    },
    {
      name: "native preserves substitution source in saved prefixes instead of skipping the argument",
      shell: "bash",
      command: "git $(printf status) diff",
      legacy: {
        commands: [
          { resource: "git $(printf status) diff", save: "git diff *" },
          { resource: "printf status", save: "printf *" },
        ],
        directories: [],
      },
      native: {
        commands: [
          { resource: "git $(printf status) diff", save: "git $(printf status) *" },
          { resource: "printf status", save: "printf *" },
        ],
        directories: [],
      },
    },
    {
      name: "directory line continuations remain unresolved source rather than legacy split operands",
      shell: "bash",
      command: "cd before\\\nafter",
      legacy: { commands: [], directories: ["before", "after"] },
      native: { commands: [], directories: ["before\\\nafter"] },
    },
    {
      name: "native recognizes PowerShell carriage-return separators omitted by the legacy AST",
      shell: "pwsh",
      command: "Get-ChildItem\rRemove-Item victim",
      legacy: { commands: [], directories: [] },
      native: {
        commands: [
          { resource: "Get-ChildItem", save: "Get-ChildItem *" },
          { resource: "Remove-Item victim", save: "Remove-Item *" },
        ],
        directories: [],
      },
    },
    {
      name: "native recognizes tab-separated PowerShell commands omitted by the legacy AST",
      shell: "pwsh",
      command: "git\tstatus",
      legacy: { commands: [], directories: [] },
      native: { commands: [{ resource: "git\tstatus", save: "git\tstatus *" }], directories: [] },
    },
    {
      name: "native preserves complete PowerShell flag=value resources",
      shell: "pwsh",
      command: "git --flag=value",
      legacy: { commands: [{ resource: "git --flag", save: "git --flag *" }], directories: [] },
      native: { commands: [{ resource: "git --flag=value", save: "git --flag=value *" }], directories: [] },
    },
    {
      name: "native does not split comma-separated PowerShell directory operands",
      shell: "pwsh",
      command: "Set-Location a,b",
      legacy: { commands: [], directories: ["a", ",b"] },
      native: { commands: [], directories: ["a,b"] },
    },
  ]) {
    test(fixture.name, async () => {
      const native = await Effect.runPromise(ShellParse.scanPortable(fixture.command, fixture.shell, "/workspace"))
      expect(native).toEqual(fixture.native)
      expect(await Effect.runPromise(ShellParse.scan(fixture.command, fixture.shell, "/workspace"))).toEqual(
        fixture.legacy,
      )
      expect(
        await Effect.runPromise(ShellParse.scan(fixture.command, fixture.shell, "/workspace", { portable: true })),
      ).toEqual(native)
      expect(native).not.toEqual(fixture.legacy)
    })
  }
})

describe("legacy directory command behavior", () => {
  test.each(["bash", "zsh", "pwsh"])("retains the original shared directory command set: %s", async (shell) => {
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
