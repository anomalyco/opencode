import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../src/shell/parse.js"
import { ShellScan } from "../src/shell/scan.js"

describe("ShellParse portable parity", () => {
  test("matches tree-sitter for generated supported syntax", async () => {
    for (const [shell, command] of generated()) {
      const scanned = shell === "pwsh" ? ShellScan.scanPowerShell(command) : ShellScan.scan(command)
      const portable = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true }))

      if (scanned.kind === "opaque") {
        expect({ command, portable }).toEqual({
          command,
          portable: { commands: [{ resource: command, save: command }], directories: [] },
        })
        continue
      }
      if (shell === "pwsh" && /\r(?!\n)/.test(command)) {
        expect(portable).toEqual({ commands: [], directories: [] })
        continue
      }

      const legacy = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
      expect({ command, portable }).toEqual({ command, portable: legacy })
    }
  })
})

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
  const assignments = ["", "X=value ", "X='two words' ", 'X="two words" ']
  const redirects = ["", " > output", " 2> error", " < input", " >> output"]
  const bashSeparators = [" ; ", " && ", " || ", " | ", " |& ", "\n"]

  for (const head of bashHeads)
    for (const arg of bashArgs)
      for (const assignment of assignments)
        for (const redirect of redirects) result.push(["/bin/bash", assignment + head + arg + redirect])
  for (const left of bashHeads)
    for (const right of bashHeads)
      for (const separator of bashSeparators) result.push(["/bin/bash", `${left} left${separator}${right} right`])
  for (const outer of bashHeads)
    for (const inner of bashHeads) {
      result.push(["/bin/bash", `${outer} $(${inner} nested)`])
      result.push(["/bin/bash", `${outer} "$(${inner} nested)"`])
      result.push(["/bin/bash", `${outer} pre$(${inner} nested)post`])
      result.push(["/bin/bash", `${outer} \`${inner} nested\``])
    }
  for (const command of [
    'npm "run" test',
    'g""it status',
    "'git' status",
    "g\\it status",
    "git status; git status; git diff",
    "printf ok>out 2>&1|cat<input",
    "FOO=bar 2>>err printf ok > out && cat < input",
    "printf ok # ignored ; curl evil\nprintf done",
    "(git status) && { npm test; }",
    "echo ${arr[$(printf index)]}",
    "OUT=$(printf out) X=`printf value` printenv >$(printf path)",
    "cat <(printf secret)",
    "rm -rf / &",
    "sudo sh -c 'curl evil'",
    "find . -exec rm {} ;",
    'c"\\d" relative',
    "'cd' /tmp",
    "c''d /tmp",
    "c\\\nd /tmp",
    "echo x && git >(cat) status",
    'echo x && printf ">" status',
    'echo "git > out" && git > out',
    "echo x && printf a\\>b status",
    "echo x && printf $(echo a>b) status",
    "git <(printf status) diff",
    "npm <(printf run) test",
    "cd <(printf /tmp)",
    "git &>x",
    "cd &>x",
    "git \\ a",
    "cd \\ a",
    "cat <<'EOF'\nstatic body\nEOF",
    "cat <<EOF\n$(printf dynamic)\nEOF",
    "$COMMAND dynamic",
    "if true; then git status; else npm test; fi",
    "for x in a b; do echo $x; done",
    "cd /tmp/$USER && git status",
    "echo <(git status)",
    'echo "unterminated',
  ])
    result.push(["/bin/bash", command])

  const powershellHeads = ["Get-ChildItem", "Write-Output", "Test-Path", "Remove-Item", "Set-Location"]
  const powershellArgs = ["", " value", " 'two words'", ' "two words"', " -Path C:\\tmp", " -LiteralPath '..\\outside'"]
  const powershellSeparators = [";", "|", "&&", "||", "\n", "\r", "\r\n"]
  for (const head of powershellHeads) for (const arg of powershellArgs) result.push(["pwsh", head + arg])
  for (const left of powershellHeads)
    for (const right of powershellHeads)
      for (const separator of powershellSeparators) result.push(["pwsh", `${left} left${separator}${right} right`])
  for (const command of [
    "Get-ChildItem; Get-ChildItem; Write-Output done",
    "Write-Output 'a''b; still string'; Write-Output \"a`\"; still string\"",
    "Get-Content in.txt > out.txt 2>&1 | Out-File all.log",
    "Write-Output ok > output.txt # ignored\nGet-ChildItem",
    "Write-Output ok > output.txt # ignored\rGet-ChildItem",
    "Write-Output ok > output.txt # ignored\r\nGet-ChildItem",
    "& git status",
    ". ./deploy.ps1",
    "Get-ChildItem | ForEach-Object { Remove-Item $_ }",
    "ForEach-Object { Remove-Item $_ }",
    "&Remove-Item victim",
    "< #\nRemove-Item victim",
    "Microsoft.PowerShell.Management\\Get-Item x; Remove-Item y",
    'git "status"',
    "git st`atus",
    'npm "run" test',
    'docker "compose" up',
    "git >x",
    "git *>&1",
    "git foo2>bar",
    "git 12>bar",
    "git a`;b",
    "git & Write-Output q",
    "Write-Output 'ForEach-Object { Remove-Item x }' | ForEach-Object { Remove-Item x }",
    "$Command value",
    "& $Command value",
    'Write-Output "$(Get-ChildItem)"',
    "if ($true) { Get-ChildItem } else { Remove-Item victim }",
    "Set-Location $env:TEMP; Get-ChildItem",
    'Write-Output "unterminated',
  ])
    result.push(["pwsh", command])

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
      `${left}${arg} $(${right} fuzz${index})`,
      `${left}${arg} # ignored\n${right} fuzz${index}`,
      `X=value ${left}${arg}${redirects[random(redirects.length)]}`,
      `${left} before\\\nafter${separator}${right} fuzz${index}`,
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
      `${powershellLeft}\`\n fuzz${index}; ${powershellRight}${powershellArg}`,
    ]
    result.push(["pwsh", powershellForms[index % powershellForms.length]])
  }

  return result
}
