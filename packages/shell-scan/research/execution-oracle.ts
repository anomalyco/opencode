import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ShellScan } from "../src/index.js"

const shells = [
  { name: "bash", path: "/opt/homebrew/bin/bash", args: ["--noprofile", "--norc"] },
  { name: "zsh", path: "/bin/zsh", args: ["-f"] },
] as const

const commands = ["oracle_alpha", "oracle_beta", "oracle_gamma", "oracle_fail"] as const
const successes = commands.slice(0, 3)
const cases = new Map<string, Set<string>>()

function add(category: string, source: string) {
  const categories = cases.get(source) ?? new Set<string>()
  categories.add(category)
  cases.set(source, categories)
}

const arguments_ = [
  "",
  " plain",
  " 'single ; | && # $(oracle_gamma)'",
  ' "double ; | && #"',
  " escaped\\;separator",
  " hash#inside",
  " 'two words' tail",
  ' "dollar $HOME"',
  " backslash\\ space",
] as const
const assignments = ["", "X=plain ", "X='two words' ", 'X="two words" '] as const
const redirects = ["", " > output", " 2> error", " < empty"] as const

for (const command of commands) {
  for (const assignment of assignments) {
    for (const argument of arguments_) {
      for (const redirect of redirects) add("simple", assignment + command + argument + redirect)
    }
  }
}

const separators = [" ; ", " && ", " || ", " | ", " |& ", "\n"] as const
for (const left of commands) {
  for (const separator of separators) {
    for (const right of successes) add("separator", left + separator + right + " final")
  }
}

const substitutions = [
  (outer: string, inner: string) => `${outer} $(${inner})`,
  (outer: string, inner: string) => `${outer} "$(${inner})"`,
  (outer: string, inner: string) => `${outer} pre$(${inner})post`,
  (outer: string, inner: string) => `X=$(${inner}) ${outer}`,
  (outer: string, inner: string) => `${outer} >$(${inner})`,
  (outer: string, inner: string) => `${outer} \`${inner}\``,
  (outer: string, inner: string) => `${outer} "$(${inner} "$(oracle_gamma)")"`,
  (outer: string, inner: string) => `${outer} "$(${inner} one; oracle_gamma two)"`,
] as const
for (const outer of successes) {
  for (const inner of commands) {
    for (const substitution of substitutions) add("substitution", substitution(outer, inner))
  }
}

for (const command of successes) {
  add("comment", `${command} before # oracle_fail ignored\noracle_beta after`)
  add("comment", `# ${command} ignored\noracle_beta after`)
  add("comment", `${command} hash#word # oracle_fail ignored`)
  add("continuation", `${command} before\\\nafter`)
  add("continuation", `${command} before \\\n after ; oracle_beta`)
  add("quote", `'${command}' quoted-head`)
  add("quote", `"${command}" quoted-head`)
  add("quote", `${command.slice(0, 7)}\\${command.slice(7)} escaped-head`)
}

add("conditional", "oracle_fail || oracle_alpha recovered")
add("conditional", "oracle_fail && oracle_alpha unreachable")
add("conditional", "oracle_alpha || oracle_fail unreachable")
add("conditional", "oracle_alpha && oracle_beta reached")
add("dynamic", "NAME=oracle_alpha; $NAME dynamic-head")
add("dynamic", "oracle_alpha $(NAME=oracle_beta; $NAME nested-dynamic)")
add("literal", "oracle_alpha '$(oracle_fail)' \"literal ` text\"")

const root = mkdtempSync(join(tmpdir(), "shell-scan-execution-oracle-"))
const bin = join(root, "bin")
const work = join(root, "work")
const log = join(root, "dispatch.log")
mkdirSync(bin)
mkdirSync(work)
await Bun.write(join(work, "empty"), "")
await Bun.write(
  join(bin, "oracle-command"),
  `#!/bin/sh
name=\${0##*/}
printf '%s\\n' "$name" >> "$ORACLE_LOG"
printf '%s\\n' "$name"
case "$name" in
  oracle_fail) exit 1 ;;
esac
`,
)
chmodSync(join(bin, "oracle-command"), 0o755)
for (const command of commands) symlinkSync("oracle-command", join(bin, command))

type Finding = {
  shell: string
  categories: string[]
  source: string
  dispatched: string[]
  scanned: string[]
  missing: string[]
  status: number
  stderr: string
}

const findings: Finding[] = []
const metrics = Object.fromEntries(
  shells.map((shell) => [shell.name, { executed: 0, scanned: 0, opaque: 0, dispatches: 0, violations: 0 }]),
)

try {
  for (const shell of shells) {
    for (const [source, categories] of cases) {
      await Bun.write(log, "")
      const result = ShellScan.scan(source)
      const execution = Bun.spawnSync([shell.path, ...shell.args, "-c", source], {
        cwd: work,
        env: {
          HOME: root,
          PATH: bin,
          ORACLE_LOG: log,
          ZDOTDIR: root,
        },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      })
      const dispatched = (await Bun.file(log).text()).split("\n").filter(Boolean)
      const metric = metrics[shell.name]
      metric.executed++
      metric.dispatches += dispatched.length
      if (result.kind === "opaque") {
        metric.opaque++
        continue
      }
      metric.scanned++
      const remaining = new Map<string, number>()
      for (const command of result.commands) {
        const name = command.words[0] ?? ""
        remaining.set(name, (remaining.get(name) ?? 0) + 1)
      }
      const missing = dispatched.filter((name) => {
        const count = remaining.get(name) ?? 0
        if (!count) return true
        remaining.set(name, count - 1)
        return false
      })
      if (!missing.length) continue
      metric.violations++
      findings.push({
        shell: shell.name,
        categories: [...categories],
        source,
        dispatched,
        scanned: result.commands.map((command) => command.words[0] ?? ""),
        missing,
        status: execution.exitCode,
        stderr: execution.stderr.toString().trim(),
      })
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(
  JSON.stringify(
    {
      schema: 1,
      invariant: "For scanned results, actual fake-executable dispatch is a multiset subset of scanned command heads.",
      generated: cases.size,
      categories: Object.fromEntries(
        [...new Set([...cases.values()].flatMap((categories) => [...categories]))].map((category) => [
          category,
          [...cases.values()].filter((categories) => categories.has(category)).length,
        ]),
      ),
      shells: shells.map((shell) => ({ name: shell.name, path: shell.path, metrics: metrics[shell.name] })),
      findings,
    },
    null,
    2,
  ),
)

if (findings.length) process.exitCode = 1
