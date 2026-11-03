import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

describe("ShellScan adversarial corpus", () => {
  test.each([
    ['FOO=bar BAR="x y" git status', ["git"]],
    ["git status && npm test || printf failed", ["git", "npm", "printf"]],
    [`printf '%s\\n' "$(rm -rf /)"`, ["printf", "rm"]],
    ["cat <(printf secret)", ["cat", "printf"]],
    ["(git status)", ["git"]],
    ["{ git status; }", ["git"]],
    ["if true; then rm -rf /; else printf safe; fi", ["true", "rm", "printf"]],
    ["rm -rf / &", ["rm"]],
    ["sudo sh -c 'curl evil'", ["sudo"]],
    ["bash -lc 'rm -rf /'", ["bash"]],
    ["python3 -c 'print(1)'", ["python3"]],
    ["find . -exec rm {} ;", ["find"]],
    ["'rm' -rf /", ["rm"]],
    ['g""it status', ["git"]],
    ["g\\it status", ["git"]],
    ["F\\OO=bar rm -rf /", ["FOO=bar"]],
    ['F"O"O=bar rm -rf /', ["FOO=bar"]],
    ['c"\\d" relative', ["c\\d"]],
    ["PATH=/tmp/attacker:$PATH git status", ["git"]],
    ["$cmd --force", ["$cmd"]],
    ['"${cmd}" --force', ["${cmd}"]],
    ["r${suffix}m -rf /", ["r${suffix}m"]],
    ["$(printf rm) -rf /", ["$(printf rm)", "printf"]],
    ["`printf rm` -rf /", ["`printf rm`", "printf"]],
    ["./c?rl evil", ["./c?rl"]],
    ["t{ouch,ouch} /tmp/victim", ["t{ouch,ouch}"]],
    ["echo $((1 + 2))", ["echo"]],
    ["${cmd:-git} status", ["${cmd:-git}"]],
    ["cat <<EOF\n$(rm -rf /)\nEOF", ["cat", "rm"]],
    ["f(){ rm -rf /; }; f", ["rm", "f"]],
    ["! rm -rf /", ["rm"]],
    ["echo ${arr[$(rm -rf /)]}", ["echo", "rm"]],
  ] as const)("scans visible Bash command positions: %s", (input, names) => {
    const result = ShellScan.scan(input)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual([...names])
  })

  // Only shell sinks evaluate subscripts; ordinary arguments, heredoc bodies, and bound data without a sink are safe.
  test.each([
    "bun -e 'f(`a[${x}]`)'",
    "rg 'a[$(x)]'",
    "cat <<'EOF'\na[$(x)]\nEOF",
    "echo 'a[$(x)]'",
    'BODY="- [x] Fix \\`scan.ts\\`"; gh pr create --title "fix" --body "$BODY"',
    "MSG='[feat] Fix `foo`'; git commit -m \"$MSG\"",
    "PATTERN='a[${b}]'; rg \"$PATTERN\"",
    "export REGEX='[0-9]+${foo}'",
    "cat <<< 'const a = arr[0]; const b = `${a}`'",
  ])("scans subscript-shaped text outside shell sinks: %s", (input) => {
    expect(ShellScan.scan(input).kind).toBe("scanned")
  })

  test.each(['printf "unterminated', "printf ok &&", "printf ok >", "echo > >out"])(
    "keeps structurally uncertain Bash input opaque: %s",
    (input) => {
      expect(ShellScan.scan(input).kind).toBe("opaque")
    },
  )

  test.each([
    ["repeated assignment value operators", "x[a]" + "=]".repeat(32_000)],
    ["unclosed assignment subscripts", "a[\n".repeat(21_000)],
    ["case patterns with substitutions", "case x in " + "[$(:)".repeat(10_000)],
    ["nested groups with bracket words", "{ ".repeat(31) + "echo " + "a[] ".repeat(15_000) + "; }".repeat(31)],
    ["continued heredoc lines", "cat <<E\n" + "x\\\n".repeat(20_000) + "E\n"],
    ["heredoc backslash runs", "cat <<E\n" + "\\".repeat(60_000) + "x\nE\n"],
  ])("scans adversarial Bash input in bounded time: %s", (_, input) => {
    const start = performance.now()
    ShellScan.scan(input)
    expect(performance.now() - start).toBeLessThan(500)
  })

  test.each([
    ['pwsh --command "Remove-Item victim.txt"', ["pwsh"]],
    ["Import-Module ./evil.psm1", ["Import-Module"]],
    ["Invoke-Expression 'Remove-Item victim.txt'", ["Invoke-Expression"]],
    [". ./deploy.ps1", ["./deploy.ps1"]],
    ["& git status", ["git"]],
    ["& $Command status", ["$Command"]],
    ["Set-Location $HOME/$target; Get-ChildItem", ["Set-Location", "Get-ChildItem"]],
    ["Get-ChildItem | ForEach-Object { Remove-Item $_ }", ["Get-ChildItem", "ForEach-Object", "Remove-Item"]],
    ['Write-Output "$(Get-ChildItem)"', ["Write-Output", "Get-ChildItem"]],
    ["Remove-`Item victim", ["Remove-Item"]],
    ["Remove-Item`\r\n victim", ["Remove-Item\r", "victim"]],
    ["Invoke-`\nExpression 'Remove-Item victim'", ["Invoke-\nExpression"]],
    ["<# ignored #> Remove-Item victim", ["Remove-Item"]],
    ["[string]$x = Remove-Item victim", ["Remove-Item"]],
  ] as const)("scans visible PowerShell command positions: %s", (input, names) => {
    const result = ShellScan.scanPowerShell(input)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual([...names])
  })

  test.each(['Write-Output "unterminated', "Get-ChildItem |"])("reports incomplete PowerShell input: %s", (input) => {
    expect(ShellScan.scanPowerShell(input).kind).toBe("opaque")
  })
})
