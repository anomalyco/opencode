import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../src/shell/parse.js"
import { ShellScan } from "../src/shell/scan.js"

describe("ShellParse native parity", () => {
  test("matches the legacy oracle across generated supported syntax without fallback", async () => {
    const commands = generated()
    expect(commands.length).toBeGreaterThan(20_000)
    for (const [shell, command] of commands) {
      const context = `${shell}: ${JSON.stringify(command)}`
      const scanned = shell === "pwsh" ? ShellScan.scanPowerShell(command) : ShellScan.scan(command)
      expect(scanned.kind, context).toBe("scanned")
      const native = await Effect.runPromise(ShellParse.scanPortable(command, shell, "/workspace"))
      const legacy = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
      expect(native, context).toEqual(legacy)
      expect(
        await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true })),
        context,
      ).toEqual(native)
    }
  }, 60_000)

  test.each([
    ["/bin/bash", "git status && npm run test -- --watch"],
    ["/bin/bash", "git\tstatus; git status | cat; git diff || echo done"],
    ["/bin/bash", "echo \"two words\"; printf 'static text'"],
    ["/bin/bash", "aws s3 ls; docker compose up; git remote add origin; bun run test"],
    ["/bin/bash", 'git "status"; git remote "add" origin; aws s3 "ls"'],
    ["/bin/bash", "echo $(curl example.test | sed s/x/y/)"],
    ["/bin/bash", "if true; then printf yes; else printf no; fi"],
    ["/bin/bash", "(git status) && { npm test; }"],
    ["/bin/bash", "(printf ok) > output"],
    ["/bin/bash", "{ printf ok; } > output"],
    ["/bin/bash", ">$(printf output)"],
    ["/bin/bash", "printf ok # ignored ; curl example.test\nprintf done"],
    ["/bin/bash", "cd ~/project; cd src && cd ..; pwd"],
    ["/bin/bash", "cd src&&cd.."],
    ["/bin/bash", "echo $((1 + 2))"],
    ["/bin/bash", "echo $((1 + $(printf 2)))"],
    ["/bin/bash", "$COMMAND status"],
    ["/bin/zsh", "cd ~/project; chdir src && cd ..; git status"],
    ["/bin/zsh", "echo $((1 + 2)); cd src&&cd.."],
    ["/bin/dash", "cd src&&cd ..; pwd"],
    ["/bin/sh", "echo $((1 + 2)); git status; cd src; pwd"],
    ["/bin/ksh", "git status; cd src; pwd"],
    ["pwsh", "Get-ChildItem; Write-Output done | Out-String"],
    ["pwsh", "Set-Location -LiteralPath C:\\tmp; Get-ChildItem"],
    ["pwsh", "git status; npm run test; docker compose up"],
    ["pwsh", 'git "status"; npm "run" test; docker "compose" up'],
    ["pwsh", "Write-Output done # comment\nGet-ChildItem"],
  ])("native resources, saved prefixes, and directories match in %s: %s", async (shell, command) => {
    const scanned = shell === "pwsh" ? ShellScan.scanPowerShell(command) : ShellScan.scan(command)
    expect(scanned.kind).toBe("scanned")
    const native = await Effect.runPromise(ShellParse.scanPortable(command, shell, "/workspace"))
    expect(native).toEqual(await Effect.runPromise(ShellParse.scan(command, shell, "/workspace")))
    expect(await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true }))).toEqual(native)
  })

  test.each(["> output", "FOO=bar", "2>> output"])(
    "returns an explicit empty result for statements without executable command nodes: %s",
    async (command) => {
      expect(ShellScan.scan(command)).toEqual({ kind: "scanned", commands: [] })
      const native = await Effect.runPromise(ShellParse.scanPortable(command, "bash", "/workspace"))
      expect(native).toEqual({ commands: [], directories: [] })
      expect(await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace"))).toEqual(native)
      expect(await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace", { portable: true }))).toEqual(
        native,
      )
    },
  )
})

describe("ShellParse malformed native syntax", () => {
  test.each([
    ["bash", 'echo "unterminated', "unterminated-quote"],
    ["bash", "printf done &&", "invalid-structure"],
    ["bash", "cat >", "invalid-redirect"],
    ["bash", ">", "invalid-redirect"],
    ["bash", "FOO=bar >", "invalid-redirect"],
    ["bash", "echo \\", "unterminated-escape"],
    ["pwsh", 'Write-Output "unterminated', "unterminated-quote"],
    ["pwsh", "git 12>bar", "invalid-redirect"],
    ["pwsh", "Write-Output `", "unterminated-escape"],
  ] as const)("fails explicitly for malformed %s syntax: %s", async (shell, command, reason) => {
    const scanned = shell === "pwsh" ? ShellScan.scanPowerShell(command) : ShellScan.scan(command)
    expect(scanned).toEqual({ kind: "opaque", reason })
    expect(await Effect.runPromise(Effect.result(ShellParse.scanPortable(command, shell, "/workspace")))).toMatchObject(
      {
        _tag: "Failure",
        failure: { message: `Portable shell scanner cannot analyze command: ${reason}` },
      },
    )
    expect(
      await Effect.runPromise(Effect.result(ShellParse.scan(command, shell, "/workspace", { portable: true }))),
    ).toMatchObject({
      _tag: "Failure",
      failure: { message: `Portable shell scanner cannot analyze command: ${reason}` },
    })
  })
})

// This generator describes a supported grammar; opaque results fail the test rather than being filtered out.
function generated() {
  const result: Array<[shell: string, command: string]> = []
  const bashHeads = ["git", "npm", "echo", "printf", "cat", "cd"]
  const bashArgs = [
    "",
    " status",
    " plain",
    " 'two words'",
    ' "two words"',
    " escaped\\ space",
    " hash#word",
    " --flag=value",
    " ./relative",
    " /tmp/absolute",
  ]
  const bashSeparators = [" ; ", " && ", " || ", " | ", " |& ", "\n"]
  const redirects = ["", " > output", " 2> error", " < input", " >> output"]
  for (const head of bashHeads)
    for (const arg of bashArgs)
      for (const assignment of ["", "X=value ", "X='two words' ", 'X="two words" '])
        for (const redirect of redirects) result.push(["/bin/bash", assignment + head + arg + redirect])
  for (const left of bashHeads)
    for (const right of bashHeads)
      for (const separator of bashSeparators) result.push(["/bin/bash", `${left} left${separator}${right} right`])
  for (const outer of ["echo", "printf", "cat"])
    for (const inner of bashHeads) {
      result.push(["/bin/bash", `${outer} $(${inner} nested)`])
      result.push(["/bin/bash", `${outer} "$(${inner} nested)"`])
      result.push(["/bin/bash", `${outer} pre$(${inner} nested)post`])
      result.push(["/bin/bash", `${outer} \`${inner} nested\``])
    }

  const powershellHeads = ["Get-ChildItem", "Write-Output", "Test-Path", "Remove-Item", "Set-Location"]
  const powershellArgs = ["", " value", " 'two words'", ' "two words"', " -Path C:\\tmp", " -LiteralPath '..\\outside'"]
  const powershellSeparators = [";", "|", "&&", "||", "\n", "\r\n"]
  for (const head of powershellHeads) for (const arg of powershellArgs) result.push(["pwsh", head + arg])
  for (const left of powershellHeads)
    for (const right of powershellHeads)
      for (const separator of powershellSeparators) result.push(["pwsh", `${left} left${separator}${right} right`])

  let state = 0x5eed1234
  const random = (length: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % length
  }
  for (let index = 0; index < 10_000; index++) {
    const left = bashHeads[random(bashHeads.length)]
    const right = bashHeads[random(bashHeads.length)]
    const arg = bashArgs[random(bashArgs.length)]
    const separator = bashSeparators[random(bashSeparators.length)]
    const bashForms = [
      `${left}${arg}${separator}${right} fuzz${index}`,
      `echo $(${right} fuzz${index})`,
      `${left}${arg} # ignored\n${right} fuzz${index}`,
      `X=value ${left}${arg}${redirects[random(redirects.length)]}`,
      `${left} 'two words'${separator}${right} fuzz${index}`,
    ]
    result.push(["/bin/bash", bashForms[index % bashForms.length]])

    const powershellLeft = powershellHeads[random(powershellHeads.length)]
    const powershellRight = powershellHeads[random(powershellHeads.length)]
    const powershellArg = powershellArgs[random(powershellArgs.length)]
    const powershellSeparator = powershellSeparators[random(powershellSeparators.length)]
    const powershellForms = [
      `${powershellLeft}${powershellArg}${powershellSeparator}${powershellRight} fuzz${index}`,
      `${powershellLeft}${powershellArg} # ignored\n${powershellRight} fuzz${index}`,
      `${powershellLeft} fuzz${index} > output; ${powershellRight}${powershellArg}`,
      `${powershellLeft} "fuzz${index}" | ${powershellRight}${powershellArg}`,
    ]
    result.push(["pwsh", powershellForms[index % powershellForms.length]])
  }
  return result
}
