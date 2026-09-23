import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

describe("PowerShell scanner safety", () => {
  test("backticks in single quotes cannot hide subsequent executions", () => {
    const result = ShellScan.scanPowerShell("Write-Output '`'; Remove-Item victim; Write-Output '`'")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words)).toEqual([
      ["Write-Output", "`"],
      ["Remove-Item", "victim"],
      ["Write-Output", "`"],
    ])
  })

  test.each([" ", "\t", "\v", "\f", "\u00a0", "\u2000", "\u2028", "\u2029", "\n", "\r", "\r\n"])(
    "recognizes comments after escaped whitespace at a token boundary %j",
    (space) => {
      expect(ShellScan.scanPowerShell(`Write-Output \`${space}#'\nRemove-Item victim\n#'`)).toMatchObject({
        kind: "scanned",
        commands: [{ words: ["Write-Output"] }, { words: ["Remove-Item", "victim"] }],
      })
      for (const redirect of ["2>&1", "6>&1", "*>&1"]) {
        expect(
          ShellScan.scanPowerShell(`% { Write-Output ${redirect}\`${space}#} '\nRemove-Item victim\n} #'`),
        ).toMatchObject({
          kind: "scanned",
          commands: [
            { words: ["%", expect.any(String)] },
            { words: ["Write-Output"] },
            { words: ["Remove-Item", "victim"] },
          ],
        })
      }
    },
  )

  test.each([" ", "\t", "\v", "\f", "\u00a0", "\u2000", "\u2028", "\u2029"])(
    "keeps backtick whitespace inside strings literal: %j",
    (space) => {
      const result = ShellScan.scanPowerShell(`% { Write-Output '\`${space}#literal' "\`${space}#literal" }`)
      expect(result.kind).toBe("scanned")
      if (result.kind === "opaque") return
      expect(result.commands[1]?.words).toEqual(["Write-Output", `\`${space}#literal`, `${space}#literal`])
    },
  )

  test.each(["x2>&1", "x6>&1"])("keeps embedded greater-than text distinct from redirects: %s", (token) => {
    expect(ShellScan.scanPowerShell(`Write-Output ${token}#'\nRemove-Item victim\n#'`)).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: `Write-Output ${token.slice(0, 3)}`, words: ["Write-Output", token.slice(0, 3)] },
        { words: ["Remove-Item", "victim"] },
      ],
    })
  })

  test.each([
    "1",
    ",1",
    "+1",
    "-1",
    ".1",
    "0x1",
    "0b1",
    "1L",
    "1kb",
    "1.0",
    "1+1",
    "1..2",
    "-not 1",
    "'x' -eq 1",
    '"x" -eq 1',
    "{} -eq 1",
  ])("recognizes expression-mode comments without inventing command heads: %s", (expression) => {
    expect(ShellScan.scanPowerShell(`${expression}#'\nRemove-Item victim\n#'`)).toMatchObject({
      kind: "scanned",
      commands: [{ words: ["Remove-Item", "victim"] }],
    })
    expect(ShellScan.scanPowerShell(`% { ${expression}#} '\nRemove-Item victim\n} #'`)).toMatchObject({
      kind: "scanned",
      commands: [{ words: ["%", expect.any(String)] }, { words: ["Remove-Item", "victim"] }],
    })
  })

  test.each(["\n", "\r", "\r\n"])("ends nested block comments at %j", (newline) => {
    const result = ShellScan.scanPowerShell(`ForEach-Object { # } ignored${newline}Remove-Item victim }`)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["ForEach-Object", "Remove-Item"])
  })

  test.each([
    'ForEach-Object { Write-Output "it\'s } literal"; Remove-Item victim }',
    'ForEach-Object { Write-Output "a\'b{c}"; Remove-Item victim }',
    "ForEach-Object { Write-Output '`'; Remove-Item victim }",
    'ForEach-Object { Write-Output "a`\"}b"; Remove-Item victim }',
    'ForEach-Object { Write-Output "a""}b"; Remove-Item victim }',
  ])("keeps block delimiters inside strings: %s", (input) => {
    const result = ShellScan.scanPowerShell(input)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual([
      "ForEach-Object",
      "Write-Output",
      "Remove-Item",
    ])
  })

  test("preserves doubled double quotes in argument values", () => {
    const result = ShellScan.scanPowerShell('Write-Output "a""b"')
    expect(result).toMatchObject({
      kind: "scanned",
      commands: [{ resource: 'Write-Output "a""b"', words: ["Write-Output", 'a"b'] }],
    })
  })

  test.each(["'safe'", '"safe"', "{ Get-Item x }"])(
    "recognizes comments after complete literal tokens: %s",
    (argument) => {
      const result = ShellScan.scanPowerShell(`Write-Output ${argument}# '\nRemove-Item victim\n# '`)
      expect(result.kind).toBe("scanned")
      if (result.kind === "opaque") return
      expect(result.commands.some((command) => command.words[0] === "Remove-Item")).toBe(true)
      expect(result.commands[0]?.resource).toBe(`Write-Output ${argument}`)
    },
  )

  test("keeps generic-token quotes distinct from standalone strings", () => {
    expect(ShellScan.scanPowerShell("Write-Output pre'safe'#literal; Get-Item x")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "Write-Output pre'safe'#literal", words: ["Write-Output", "presafe#literal"] },
        { resource: "Get-Item x", words: ["Get-Item", "x"] },
      ],
    })
    expect(ShellScan.scanPowerShell("Write-Output 'safe'tail")).toMatchObject({
      kind: "scanned",
      commands: [{ resource: "Write-Output 'safe'tail", words: ["Write-Output", "safe", "tail"] }],
    })
  })

  test("block matching agrees with tokenization after a merging redirect", () => {
    const result = ShellScan.scanPowerShell("% { Get-Item x 2>&1# } '\nRemove-Item victim\n} # '")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["%", "Get-Item", "Remove-Item"])
  })

  test.each([
    'cmd.exe \u0085--% "ignored\nRemove-Item victim\n# "',
    "Write-Output \u2018a'; Remove-Item victim; Write-Output 'b\u2019",
    'Write-Output \u201ca"; Remove-Item victim; Write-Output "b\u201d',
  ])("refuses unsupported lexical modes: %s", (input) => {
    expect(ShellScan.scanPowerShell(input).kind).toBe("opaque")
  })

  test.each(["\n", "\r", "\r\n"])("ends stop-parsing at %j even adjacent to completed tokens", (newline) => {
    for (const argument of ["'x'", '"x"', "{}"]) {
      const result = ShellScan.scanPowerShell(`Write-Output ${argument}--% '${newline}Remove-Item victim${newline}# '`)
      expect(result).toMatchObject({
        kind: "scanned",
        commands: [{ words: ["Write-Output", expect.any(String), "--%", "'"] }, { words: ["Remove-Item", "victim"] }],
      })
      const block = ShellScan.scanPowerShell(
        `% { Write-Output ${argument}--%} '${newline}Remove-Item victim${newline}} # '`,
      )
      expect(block.kind).toBe("scanned")
      if (block.kind === "scanned") expect(block.commands.at(-1)?.words).toEqual(["Remove-Item", "victim"])
    }
  })

  test.each([
    "& '' victim",
    "Write-Output ok > > out",
    "Write-Output ok > 2>&1",
    "Write-Output ok 2>&",
    "Write-Output ok 2>&2",
    "Write-Output ok 1>&1",
    "Write-Output ok >&1",
    "Write-Output ok 7> out",
    "Write-Output ok 2>>&1",
    "Write-Output ok > # missing target\nRemove-Item victim",
    "Write-Output ok | # missing pipeline\n",
    "| Remove-Item victim",
    "&& Remove-Item victim",
    "& & Remove-Item victim",
    "&",
    ".",
    "Write-Output ok; &",
    "Write-Output ok; .",
    "Set-Location \u2013StackName old",
    "Set-Location \u2014StackName old",
    "Set-Location \u2015StackName old",
  ])("reports malformed or unsupported lexical syntax: %s", (input) => {
    expect(ShellScan.scanPowerShell(input).kind).toBe("opaque")
  })

  test.each(["Set-Location", "SL", "cd", "chdir", "Push-Location", "pushd", "Microsoft.PowerShell.Management\\sl"])(
    "preserves commands with directory variables for Core policy through %s",
    (head) => {
      expect(ShellScan.scanPowerShell(`${head} $target; Get-Item x`)).toMatchObject({
        kind: "scanned",
        commands: [
          { resource: `${head} $target`, words: [head, "$target"] },
          { resource: "Get-Item x", words: ["Get-Item", "x"] },
        ],
      })
      expect(ShellScan.scanPowerShell(`${head} $HOME/project; Get-Item x`).kind).toBe("scanned")
    },
  )

  test.each([
    "Pop-Location",
    "popd",
    "Microsoft.PowerShell.Management\\Pop-Location",
    "Set-Location -",
    "Set-Location +",
    "Set-Location -StackName old",
    "Set-Location -st old",
    "Set-Location -Path:C:relative",
    "Set-Location C:relative",
    "Set-Location Registry::HKEY_CURRENT_USER",
    "Set-Location $HOME/$target",
  ])("preserves directory command syntax without deciding directory policy: %s", (input) => {
    expect(ShellScan.scanPowerShell(`${input}; Get-Item x`)).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: input, words: input.split(" ") },
        { resource: "Get-Item x", words: ["Get-Item", "x"] },
      ],
    })
  })

  test.each(["%", "?", "foreach", "where", "iex"])("keeps command aliases visible: %s", (head) => {
    const result = ShellScan.scanPowerShell(`Get-Item x | ${head} { Remove-Item victim }`)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["Get-Item", head, "Remove-Item"])
  })

  test.each(["Get-*", "./g?t", "./[gr]it", ".\\script.ps1", "..\\scripts\\run.ps1", "\\\\host\\share\\run.ps1"])(
    "retains command names and paths without resolving them: %s",
    (head) => {
      expect(ShellScan.scanPowerShell(`& ${head} victim`)).toMatchObject({
        kind: "scanned",
        commands: [{ resource: `& ${head} victim`, words: [head, "victim"], rawWords: [head, "victim"] }],
      })
    },
  )

  test("recursively extracts commands from nested script blocks", () => {
    const result = ShellScan.scanPowerShell("Get-Item x | % { Get-Item y | ? { Remove-Item victim } }")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual([
      "Get-Item",
      "%",
      "Get-Item",
      "?",
      "Remove-Item",
    ])
  })

  test("keeps hashes within words out of block-comment detection", () => {
    const result = ShellScan.scanPowerShell("% { Write-Output a#b }; Remove-Item victim")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["%", "Write-Output", "Remove-Item"])
  })

  test.each([";", "&", "\n", "\r", "\r\n"])("never invents a command after a trailing %j", (separator) => {
    expect(ShellScan.scanPowerShell(`Get-Item x${separator}`)).toMatchObject({
      kind: "scanned",
      commands: [{ resource: "Get-Item x", words: ["Get-Item", "x"] }],
    })
  })

  test.each(["'victim'", '"victim"', "`victim", "{ Get-Item victim }"])(
    "does not clear a dangling pipeline with a new empty statement: %s",
    (tail) => {
      expect(ShellScan.scanPowerShell(`Get-Item x | ; Write-Output ${tail}`).kind).toBe("opaque")
    },
  )

  test("scans valid redirects without consuming command arguments", () => {
    for (const redirect of [">", ">>", "1>", "2>>", "3>", "4>", "5>", "6>", "*>", "*>>"]) {
      expect(ShellScan.scanPowerShell(`Get-Item x ${redirect} out.txt | Write-Output done`)).toMatchObject({
        kind: "scanned",
        commands: [
          { resource: `Get-Item x ${redirect} out.txt`, words: ["Get-Item", "x"] },
          { resource: "Write-Output done", words: ["Write-Output", "done"] },
        ],
      })
    }
    for (const redirect of ["2>&1", "3>&1", "4>&1", "5>&1", "6>&1", "*>&1"]) {
      expect(ShellScan.scanPowerShell(`Get-Item x ${redirect}`)).toMatchObject({
        kind: "scanned",
        commands: [{ resource: `Get-Item x ${redirect}`, words: ["Get-Item", "x"] }],
      })
    }
  })

  test("bounds script block nesting and input size", () => {
    expect(ShellScan.scanPowerShell("% { ".repeat(33) + "Get-Item x" + " }".repeat(33)).kind).toBe("opaque")
    expect(ShellScan.scanPowerShell(`Write-Output ${"x".repeat(64 * 1024)}`).kind).toBe("opaque")
  })
})
