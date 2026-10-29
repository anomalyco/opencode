import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../src/shell/parse.js"
import { Wildcard } from "../src/util/wildcard.js"

describe("native shell syntax compatibility", () => {
  test("PowerShell invocation approvals include the operator instead of saving an ineffective prefix", async () => {
    const command = "& $Command value"
    expect(await Effect.runPromise(ShellParse.scan(command, "pwsh", "/workspace"))).toEqual({
      commands: [{ resource: command, save: "& $Command *" }],
      directories: [],
    })
  })

  test.each([
    "ForEach-Object { Write-Output value }",
    "Write-Output before; ForEach-Object { Write-Output value }",
    "ForEach-Object { Write-Output value } | Write-Output done",
    "Write-Output before | ForEach-Object { Write-Output $_ }",
    "& ForEach-Object { Write-Output value }",
    "& 'ForEach-Object' { Write-Output value }",
    "% { Write-Output value }",
    "Where-Object { Write-Output value }",
  ])("PowerShell scriptblock callers preserve permission resources and usable approvals: %s", async (command) => {
    const native = await Effect.runPromise(ShellParse.scan(command, "pwsh", "/workspace"))
    for (const item of native.commands) expect(Wildcard.match(item.resource, item.save), item.resource).toBe(true)
  })

  for (const shell of ["bash", "zsh"]) {
    test.each([
      "cat <<'EOF'\n$(not_a_command)\nEOF",
      "cat <<EOF\n$(printf hello)\nEOF",
      "cat <<-EOF\n\thello\n\tEOF",
      "cat <<EOF\nhello\nEOF\nprintf done",
      'cat <<< "$(printf hello)"',
      "for file in a b; do printf '%s' \"$file\"; done",
      "for file in $(printf file); do printf '%s' \"$file\"; done",
      'for file in a b; do if test -n "$file"; then printf \'%s\' "$file"; fi; done',
      "while IFS= read -r file; do printf '%s' \"$file\"; done < input",
      "until test -f ready; do sleep 1; done",
      "if true; then if false; then printf no; else printf yes; fi; fi",
      "if true; then :; X=$(printf value); fi",
      'case "$target" in *.ts) printf typescript;; *) printf other;; esac',
      "greet() { printf hello; }; greet",
      "function greet { printf hello; }; greet",
      "printf before; { printf grouped; }; (printf subshell)",
      "time git status",
      "time -p git status",
      "coproc git status",
      "if [[ -f file ]]; then cat file; fi",
      "[[ $(printf yes) = yes ]]",
      "echo ${value:-default}",
      'echo "${value:-$(printf fallback)}"',
      "echo ${value//before/after}",
      "echo ${arr[$(printf index)]}",
      "printf '%s' $'line1\\nline2'",
      "printf '%s' $'\\u2713\\U0001f642'",
      'printf "%s" $"hello"',
      "echo $((1 + ${value:-2}))",
      "echo $((array[$(printf 0)]))",
      "echo $[1 + 2]",
      "((count++))",
      "for ((i=0; i<2; i++)); do printf ok; done",
      "echo `printf \\2`",
      "F='$HOME/bin'; SIZE=4096; N=$(( (SIZE + 1023) / 1024 )); echo $N",
    ])(`${shell} extracts commands without rejecting ordinary syntax: %s`, async (command) => {
      const scanned = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
      expect(await Effect.runPromise(ShellParse.scanPortable(command, shell, "/workspace"))).toEqual(scanned)
    })
  }

  test("does not invent commands from a quoted second heredoc body", async () => {
    const command = "cat <<FIRST <<'SECOND'\n$(printf first)\nFIRST\n$(not_a_command)\nSECOND"
    const expected = {
      commands: [
        { resource: command, save: "cat *" },
        { resource: "printf first", save: "printf *" },
      ],
      directories: [],
    }
    expect(await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace"))).toEqual(expected)
  })

  test("keeps heredoc and here-string spans attached to their own commands across lists and pipelines", async () => {
    expect(
      await Effect.runPromise(
        ShellParse.scan("true && cat <<'EOF' && git status\nhello\nEOF", "bash", "/workspace"),
      ),
    ).toEqual({
      commands: [
        { resource: "true", save: "true *" },
        { resource: "cat", save: "cat *" },
        { resource: "git status", save: "git status *" },
      ],
      directories: [],
    })

    expect(
      await Effect.runPromise(ShellParse.scan("cat <<'EOF' && git status\nhello\nEOF", "bash", "/workspace")),
    ).toEqual({
      commands: [
        { resource: "cat <<'EOF'", save: "cat *" },
        { resource: "git status", save: "git status *" },
      ],
      directories: [],
    })

    expect(
      await Effect.runPromise(
        ShellParse.scan("if cat <<'EOF' | grep -q hi; then echo ok; fi\nhi\nEOF", "bash", "/workspace"),
      ),
    ).toEqual({
      commands: [
        { resource: "cat <<'EOF'", save: "cat *" },
        { resource: "grep -q hi", save: "grep *" },
        { resource: "echo ok", save: "echo *" },
      ],
      directories: [],
    })

    expect(
      await Effect.runPromise(
        ShellParse.scan("true && git add -p file.rs <<< $'n\\ny\\n' >/dev/null", "bash", "/workspace"),
      ),
    ).toEqual({
      commands: [
        { resource: "true", save: "true *" },
        { resource: "git add -p file.rs <<< $'n\\ny\\n'", save: "git add *" },
      ],
      directories: [],
    })
  })

  test("scans Zsh glob qualifiers, indirect parameter flags, and disown operators while rejecting code qualifiers", async () => {
    expect(
      await Effect.runPromise(
        ShellParse.scan(
          'for f in locks/waiter-*(N); do echo "${(P)f}"; done; ls -d src/**/target(N/) *.ts(.OL[1,3]); nohup sleep 1 >/dev/null 2>&1 &! ; echo started',
          "zsh",
          "/workspace",
        ),
      ),
    ).toEqual({
      commands: [
        { resource: 'echo "${(P)f}"', save: "echo *" },
        { resource: "ls -d src/**/target(N/) *.ts(.OL[1,3])", save: "ls *" },
        { resource: "nohup sleep 1 >/dev/null 2>&1", save: "nohup *" },
        { resource: "echo started", save: "echo *" },
      ],
      directories: [],
    })

    for (const unsafe of [
      "echo *(e:'rm -rf /':)",
      "echo *(+cmd)",
      "echo *(+1)",
      "echo *(P:-f:)",
      "echo *(u:root:)",
      "echo *(:Q)",
      "a=(1); r='a[$(printf pwn)]'; echo ${(P)r}",
    ]) {
      expect(await Effect.runPromise(Effect.result(ShellParse.scan(unsafe, "zsh", "/workspace")))).toMatchObject({
        _tag: "Failure",
        failure: { message: "Portable shell scanner cannot analyze command: dynamic-execution" },
      })
    }
  })

  test.each([
    ["bash", "x=\"a$(printf '\\x5b')\\$(touch pwn)]\"; echo $((x))"],
    ["bash", "x=$(printf 'a\\x5b\\x24\\x28touch pwn\\x29]'); echo $((x))"],
    ["bash", "x=$(echo 'a{$(touch pwn)]' | tr '{' '\\133'); (( x ))"],
    ["bash", "F='$HOME/bin'; SIZE=$(stat -f %z file); N=$(( (SIZE + 1023) / 1024 )); echo $N"],
    ["zsh", "r=\"a$(printf '\\x5b')\\$(touch pwn)]\"; echo ${(P)r}"],
  ])("%s rejects variable sinks when a substitution can build the subscript: %s", async (shell, command) => {
    expect(await Effect.runPromise(Effect.result(ShellParse.scan(command, shell, "/workspace")))).toMatchObject({
      _tag: "Failure",
      failure: { message: "Portable shell scanner cannot analyze command: dynamic-execution" },
    })
  })

  test.each([
    'Write-Output "$(Get-Location)"',
    "$value = Get-Date; Write-Output $value",
    "if ($true) { Write-Output yes } else { Write-Output no }",
    "if (Test-Path file) { Get-Item file }",
    "foreach ($value in @('a','b')) { Write-Output $value }",
    "for ($i=0; $i -lt 2; $i++) { Write-Output $i }",
    "while (Test-Path file) { Get-Item file; break }",
    "function Show-Value { Write-Output value }; Show-Value",
    "Get-Item -Path (Join-Path src file)",
    'Write-Output "line1`nline2"',
    "Write-Output `\n  continued",
    "<# comment #> Write-Output done",
    "Write-Output @'\nhello\n'@",
    "git st`atus",
  ])("PowerShell extracts commands without rejecting ordinary syntax: %s", async (command) => {
    const scanned = await Effect.runPromise(ShellParse.scan(command, "pwsh", "/workspace"))
    expect(await Effect.runPromise(ShellParse.scanPortable(command, "pwsh", "/workspace"))).toEqual(scanned)
  })
})
