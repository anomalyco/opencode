import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../src/shell/parse.js"
import { compatibilityCases } from "./fixture/shell-parse-cases"

describe("portable shell parser compatibility", () => {
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
          console.log(JSON.stringify(scanned))
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
        expect(JSON.parse(output)).toEqual(expected)
        return
      }
      const scanned = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
      expect(scanned).toEqual(expected)
    },
  )

  test("derives the prefix for long argument lists", async () => {
    const command = `echo ${"x ".repeat(16_000)}`.trimEnd()
    const result = await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace"))
    expect(result).toEqual({ commands: [{ resource: command, save: "echo *" }], directories: [] })
  })

  test("extracts inline PowerShell directory flags with case-insensitive names and quoted values", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan(
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
      ShellParse.scan("ForEach-Object -InputObject $proc -MemberName Kill", "pwsh", "/workspace"),
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
      name: "retains redirect resource for an assignment with redirection",
      shell: "bash",
      command: "FOO=bar > output",
      expected: { commands: [{ resource: "FOO=bar > output", save: "FOO=bar > *" }], directories: [] },
    },
    {
      name: "retains both redirect resource and nested executable commands on assignment redirection",
      shell: "bash",
      command: "FOO=$(printf value) > output",
      expected: {
        commands: [
          { resource: "FOO=$(printf value) > output", save: "FOO=$(printf value) > *" },
          { resource: "printf value", save: "printf *" },
        ],
        directories: [],
      },
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
    {
      name: "retains unresolved PowerShell stack, history, and dot-wildcard directory commands",
      shell: "pwsh",
      command:
        "Set-Location -StackName old; Set-Location -; Set-Location +; Set-Location .[.] ; Set-Location -LiteralPath '.[.]'",
      expected: {
        commands: [
          { resource: "Set-Location -StackName old", save: "Set-Location *" },
          { resource: "Set-Location -", save: "Set-Location *" },
          { resource: "Set-Location +", save: "Set-Location *" },
          { resource: "Set-Location .[.]", save: "Set-Location *" },
        ],
        directories: [".[.]"],
      },
    },
  ]) {
    test(fixture.name, async () => {
      const scanned = await Effect.runPromise(ShellParse.scan(fixture.command, fixture.shell, "/workspace"))
      expect(scanned).toEqual(fixture.expected)
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
