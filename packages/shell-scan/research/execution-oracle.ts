import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ShellScan } from "../src/index.js"

const shells = [
  { name: "bash", path: "/opt/homebrew/bin/bash", args: ["--noprofile", "--norc"], strict: true },
  { name: "bash-system", path: "/bin/bash", args: ["--noprofile", "--norc"], strict: false },
  { name: "zsh", path: "/bin/zsh", args: ["-f"], strict: true },
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
add("literal", "oracle_alpha '$(oracle_fail)' 'literal ` text'")

let randomState = 0x5eed1234
const random = (length: number) => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
  return randomState % length
}
const atoms = [
  ...commands,
  ...successes.map((command) => `${command} plain`),
  ...successes.map((command) => `${command} 'literal ; | #'`),
  ...successes.map((command) => `${command} \"literal ; | #\"`),
  ...successes.map((command) => `X=value ${command}`),
] as const
for (let iteration = 0; iteration < 2_500; iteration++) {
  const left = `${atoms[random(atoms.length)]} fuzz${iteration}`
  const right = `${atoms[random(atoms.length)]} fuzz${iteration}`
  const nested = successes[random(successes.length)]
  const forms = [
    `${left}${separators[random(separators.length)]}${right}`,
    `${left} $(${right})`,
    `${left} \"$(${right})\"`,
    `${left} pre$(${right})post`,
    `X=$(${right}) ${left}`,
    `${left} $(${right}; ${nested})`,
    `${left} before # ignored\n${right}`,
    `${left} before\\\nafter; ${right}`,
  ]
  add("deterministic-random", forms[iteration % forms.length])
}

const executionCases = [...cases].map(([source, categories], caseIndex) => {
  let occurrence = 0
  const names: string[] = []
  const unique = source.replace(/\boracle_(\\?)(?:alpha|beta|gamma|fail)\b/g, (_, escaped: string) => {
    const name = `oracle_${caseIndex}_${occurrence++}`
    names.push(name)
    if (!escaped) return name
    return name.slice(0, -1) + "\\" + name.at(-1)
  })
  return { source: unique, categories, names }
})

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
[ "$ORACLE_MODE" = failure ] && exit 1
`,
)
chmodSync(join(bin, "oracle-command"), 0o755)
for (const name of executionCases.flatMap((item) => item.names)) symlinkSync("oracle-command", join(bin, name))

type Finding = {
  shell: string
  categories: string[]
  source: string
  dispatched: string[]
  scanned: string[]
  missing: string[]
  status: number
  stderr: string
  reason: "dispatch" | "parse"
}

const findings: Finding[] = []
const metrics = Object.fromEntries(
  shells.map((shell) => [shell.name, { executed: 0, parsed: 0, scanned: 0, opaque: 0, dispatches: 0, violations: 0 }]),
)
const coverage = Object.fromEntries(
  shells.flatMap((shell) =>
    [...new Set(executionCases.flatMap((item) => [...item.categories]))].map((category) => [
      `${shell.name}:${category}`,
      { scanned: 0, dispatches: 0 },
    ]),
  ),
)
const versions = Object.fromEntries(
  shells.map((shell) => {
    const version = Bun.spawnSync([shell.path, "--version"], { stdout: "pipe", stderr: "pipe" })
    return [shell.name, (version.stdout.toString() || version.stderr.toString()).split("\n")[0]?.trim()]
  }),
)

try {
  for (const shell of shells) {
    for (const { source, categories } of executionCases) {
      const result = ShellScan.scan(source)
      const metric = metrics[shell.name]
      metric.executed++
      const parsed = Bun.spawnSync([shell.path, ...shell.args, "-n", "-c", source], {
        cwd: work,
        env: { HOME: root, PATH: bin, ZDOTDIR: root },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      })
      if (parsed.exitCode === 0) metric.parsed++
      if (result.kind === "scanned" && parsed.exitCode !== 0 && shell.strict) {
        metric.violations++
        findings.push({
          shell: shell.name,
          categories: [...categories],
          source,
          dispatched: [],
          scanned: result.commands.map((command) => command.words[0] ?? ""),
          missing: [],
          status: parsed.exitCode,
          stderr: parsed.stderr.toString().trim(),
          reason: "parse",
        })
        continue
      }
      if (parsed.exitCode !== 0) continue
      if (result.kind === "opaque") {
        metric.opaque++
        continue
      }
      metric.scanned++
      const dispatched = new Set<string>()
      let status = 0
      let stderr = ""
      for (const mode of ["success", "failure"]) {
        await Bun.write(log, "")
        const execution = Bun.spawnSync([shell.path, ...shell.args, "-c", source], {
          cwd: work,
          env: { HOME: root, PATH: bin, ORACLE_LOG: log, ORACLE_MODE: mode, ZDOTDIR: root },
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        })
        status = execution.exitCode
        stderr = execution.stderr.toString().trim()
        if (execution.exitCode === 127 || /command not found|not found/i.test(execution.stderr.toString())) {
          metric.violations++
          findings.push({
            shell: shell.name,
            categories: [...categories],
            source,
            dispatched: [...dispatched],
            scanned: result.commands.map((command) => command.words[0] ?? ""),
            missing: [],
            status: execution.exitCode,
            stderr: execution.stderr.toString().trim(),
            reason: "dispatch",
          })
        }
        for (const name of (await Bun.file(log).text()).split("\n").filter(Boolean)) dispatched.add(name)
      }
      metric.dispatches += dispatched.size
      for (const category of categories) {
        coverage[`${shell.name}:${category}`].scanned++
        coverage[`${shell.name}:${category}`].dispatches += dispatched.size
      }
      const remaining = new Set(result.commands.map((command) => command.words[0] ?? ""))
      const missing = [...dispatched].filter((name) => {
        return !remaining.has(name)
      })
      if (!missing.length) continue
      metric.violations++
      findings.push({
        shell: shell.name,
        categories: [...categories],
        source,
        dispatched: [...dispatched],
        scanned: result.commands.map((command) => command.words[0] ?? ""),
        missing,
        status,
        stderr,
        reason: "dispatch",
      })
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

for (const shell of shells) {
  const metric = metrics[shell.name]
  if (metric.scanned < 2_000 || metric.dispatches < 4_000) {
    throw new Error(
      `${shell.name} coverage fell below floor: ${metric.scanned} scanned, ${metric.dispatches} dispatches`,
    )
  }
  for (const category of [
    "simple",
    "separator",
    "substitution",
    "comment",
    "continuation",
    "conditional",
    "literal",
    "deterministic-random",
  ]) {
    const item = coverage[`${shell.name}:${category}`]
    if (!item || item.scanned === 0 || item.dispatches === 0)
      throw new Error(`${shell.name}:${category} has no scanned dispatch coverage`)
  }
}

console.log(
  JSON.stringify(
    {
      schema: 1,
      invariant: "For scanned results, every uniquely named fake-executable dispatch appears in scanned command heads.",
      generated: executionCases.length,
      categories: Object.fromEntries(
        [...new Set([...cases.values()].flatMap((categories) => [...categories]))].map((category) => [
          category,
          [...cases.values()].filter((categories) => categories.has(category)).length,
        ]),
      ),
      shells: shells.map((shell) => ({
        name: shell.name,
        path: shell.path,
        version: versions[shell.name],
        strictSyntax: shell.strict,
        metrics: metrics[shell.name],
      })),
      coverage,
      findings,
    },
    null,
    2,
  ),
)

if (findings.length) process.exitCode = 1
