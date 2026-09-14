import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

describe("PowerShell practical syntax", () => {
  test.each([
    ["$result = git status", ["git status"]],
    ["$result += (git status)", ["git status"]],
    ["[string]$result = git status", ["git status"]],
    ["$x = 1; $x++; git status", ["git status"]],
    ["$true; 1 + 2; 'literal'; git status", ["git status"]],
    ["${result}# ignored\ngit status", ["git status"]],
    [
      "Write-Output { ${result}# ignored\ngit status }",
      ["Write-Output { ${result}# ignored\ngit status }", "git status"],
    ],
    ["Switch-Branch main; Function-Name arg", ["Switch-Branch main", "Function-Name arg"]],
    ["(git status)", ["git status"]],
    ["@(git status; git diff)", ["git status", "git diff"]],
    ["$x = @{ status = git status; count = 1 }", ["git status"]],
    ["if (Test-Path file) { git status } else { git diff }", ["Test-Path file", "git status", "git diff"]],
    ["if ($true) { git status } elseif ($false) { git diff }", ["git status", "git diff"]],
    ["foreach ($file in (Get-ChildItem .)) { Get-Content $file }", ["Get-ChildItem .", "Get-Content $file"]],
    ["foreach ($file in Get-ChildItem .) { Get-Content $file }", ["Get-ChildItem .", "Get-Content $file"]],
    ["for ($i = 0; $i -lt 2; $i++) { git status }", ["git status"]],
    ["while (Test-Path file) { git status; break }", ["Test-Path file", "git status"]],
    ["do { git status } until ($true)", ["git status"]],
    ["function Get-Status { param($file); git status }; Get-Status", ["git status", "Get-Status"]],
    ["function Get-Status($file = (Get-Item .)) { git status }", ["Get-Item .", "git status"]],
    [
      "try { git status } catch { Write-Output $_ } finally { git diff }",
      ["git status", "Write-Output $_", "git diff"],
    ],
    ["& { git status }", ["& { git status }", "git status"]],
    ["return git status", ["git status"]],
    ["<# <# ignored } #> #> ignored\ngit status", ["git status"]],
    ["git <# ignored #> status", ["git <# ignored #> status"]],
    ['Write-Output "$(git status)"', ['Write-Output "$(git status)"', "git status"]],
    [
      'Write-Output "$(Write-Output "$(git status)")"',
      ['Write-Output "$(Write-Output "$(git status)")"', 'Write-Output "$(git status)"', "git status"],
    ],
    ["Write-Output @'\n$(not-a-command)\n'@; git status", ["Write-Output @'\n$(not-a-command)\n'@", "git status"]],
    ['Write-Output @"\n$(git status)\n"@', ['Write-Output @"\n$(git status)\n"@', "git status"]],
    [
      "cmd.exe --% $(literal) > literal.txt; still-literal\ngit status",
      ["cmd.exe --% $(literal) > literal.txt; still-literal", "git status"],
    ],
    [
      'cmd.exe --% "literal|still-literal" | Write-Output done',
      ['cmd.exe --% "literal|still-literal"', "Write-Output done"],
    ],
    ["Write-Output '--%' ; git status", ["Write-Output '--%'", "git status"]],
    ["Write-Output prefix--% literal; git status", ["Write-Output prefix--% literal", "git status"]],
    ["git status |\n\n# comment\nOut-String", ["git status", "Out-String"]],
  ] as const)("extracts command resources from %s", (source, resources) => {
    const result = ShellScan.scanPowerShell(source)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.resource)).toEqual([...resources])
  })

  test.each(["\n", "\r", "\r\n"])(
    "distinguishes standalone continuations from escapes inside tokens: %j",
    (newline) => {
      expect(ShellScan.scanPowerShell(`git \`${newline}\tstatus`)).toMatchObject({
        kind: "scanned",
        commands: [{ words: ["git", "status"], rawWords: ["git", "status"] }],
      })
      expect(ShellScan.scanPowerShell(`Write-Output left\`${newline}right`)).toMatchObject({
        kind: "scanned",
        commands: [
          { words: ["Write-Output", `left${newline}right`], rawWords: ["Write-Output", `left\`${newline}right`] },
        ],
      })
    },
  )

  test("decodes literal backtick escapes without evaluating expressions", () => {
    const source = '& "Wr`ite-Output" "tab`tnewline`n`u{1f642}" left`;right'
    expect(ShellScan.scanPowerShell(source)).toMatchObject({
      kind: "scanned",
      commands: [
        {
          resource: source,
          words: ["Write-Output", "tab\tnewline\n\u{1f642}", "left;right"],
          rawWords: ['"Wr`ite-Output"', '"tab`tnewline`n`u{1f642}"', "left`;right"],
        },
      ],
    })
  })

  test("preserves word offsets relative to each raw command, including nested invocations", () => {
    const source = '  & git\tstatus\t--short; Write-Output "$(git\tlog)"'
    const result = ShellScan.scanPowerShell(source)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands[0]?.wordEnds).toEqual([5, 12, 20])
    expect(result.commands[2]?.resource).toBe("git\tlog")
    for (const command of result.commands) {
      expect(command.wordEnds).toHaveLength(command.rawWords.length)
      for (const [index, word] of command.rawWords.entries()) {
        const end = command.wordEnds![index]!
        expect(command.resource.slice(end - word.length, end)).toBe(word)
      }
    }
  })

  test.each([
    ["ForEach-Object { git status }", true],
    ["git status; ForEach-Object { git diff }", true],
    ["git status | ForEach-Object { git diff }", undefined],
    ["git status && ForEach-Object { git diff }", undefined],
    ["git status || ForEach-Object { git diff }", undefined],
    ["& ForEach-Object { git status }", undefined],
    ["& 'ForEach-Object' { git status }", undefined],
    ["% { git status }", true],
    ["foreachthing { git status }", true],
  ] as const)("retains caller and lexical statement-head context: %s", (source, statementHead) => {
    const result = ShellScan.scanPowerShell(source)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    const caller = result.commands.find((command) => command.rawWords.at(-1)?.startsWith("{"))
    expect(caller).toBeDefined()
    expect(caller?.statementHead).toBe(statementHead)
    expect(result.commands.at(-1)?.words[0]).toBe("git")
  })

  test.each([
    "if ($true) { git status",
    'Write-Output "$(git status"',
    "Write-Output @(git status",
    "Write-Output @'\nunclosed",
    "<# unclosed",
    "git status |\n# no operand",
    "Write-Output `u{110000}",
    "Write-Output `u{xyz}",
  ])("bounds and reports incomplete lexical structures: %s", (source) => {
    expect(ShellScan.scanPowerShell(source).kind).toBe("opaque")
  })

  test("bounds mixed expression, string, and block recursion", () => {
    expect(ShellScan.scanPowerShell("$(".repeat(40) + "git status" + ")".repeat(40)).kind).toBe("opaque")
    expect(ShellScan.scanPowerShell('Write-Output "$('.repeat(40) + "git status" + ')"'.repeat(40)).kind).toBe("opaque")
  })
})
