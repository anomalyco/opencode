import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { parseRunOutput } from "./parse"
import { tasks } from "./tasks"
import type { ProcessResult, RunResult, Task, Usage } from "./types"

const evalDir = import.meta.dir
const repoRoot = resolve(evalDir, "..")
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const VERIFY_TIMEOUT_MS = 2 * 60 * 1000
// Disposable workspaces live outside the repo so the root bunfig test guard cannot apply.
const workspaceRoot = join(tmpdir(), "opencode", "eval", stamp() + "-" + process.pid)

type Baseline = {
  commit: string
  dirty: boolean
  bun: string
  platform: string
  startedAt: string
}

type Options = {
  model?: string
  agent: string
  tasks?: string
  repeat: number
  timeout: number
  out: string
  bin?: string
  list: boolean
  audit: boolean
  dryRun: boolean
  keep: boolean
  gate: boolean
  failOnUnverified: boolean
  help: boolean
}

type VerifyContext = {
  finalText: string
  gitStatus: string
  diff: string
}

type CategorySummary = {
  category: string
  runs: number
  verified: number
  cost: number
}

type Report = {
  baseline: Baseline
  config: {
    model: string
    agent: string
    repeat: number
    timeoutMs: number
    gate: boolean
    tasks: string[]
  }
  startedAt: string
  finishedAt: string
  runs: number
  verified: number
  validCompletions: number
  verifiedSuccessRate: number
  validCompletionRate: number
  totalCost: number
  costPerVerifiedSuccess: number | null
  medianDurationMs: number
  p90DurationMs: number
  totalTokens: number
  toolCalls: number
  toolErrors: number
  toolErrorRate: number
  byCategory: CategorySummary[]
  results: RunResult[]
}

function parseOptions(): Options {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      model: { type: "string", short: "m" },
      agent: { type: "string", short: "a" },
      tasks: { type: "string", short: "t" },
      repeat: { type: "string", default: "1" },
      timeout: { type: "string" },
      out: { type: "string" },
      bin: { type: "string" },
      list: { type: "boolean", default: false },
      audit: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      keep: { type: "boolean", default: false },
      gate: { type: "boolean", default: false },
      "fail-on-unverified": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  })
  const values = parsed.values
  const repeat = Number(typeof values.repeat === "string" ? values.repeat : "1")
  const timeoutValue = typeof values.timeout === "string" ? Number(values.timeout) : DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer")
  if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) throw new Error("--timeout must be a positive number")
  const out = typeof values.out === "string" ? resolve(values.out) : join(evalDir, ".runs", stamp())
  return {
    model: typeof values.model === "string" ? values.model : undefined,
    agent: typeof values.agent === "string" ? values.agent : "build",
    tasks: typeof values.tasks === "string" ? values.tasks : undefined,
    repeat,
    timeout: timeoutValue,
    out,
    bin: typeof values.bin === "string" ? values.bin : undefined,
    list: values.list === true,
    audit: values.audit === true,
    dryRun: values["dry-run"] === true,
    keep: values.keep === true,
    gate: values.gate === true,
    failOnUnverified: values["fail-on-unverified"] === true,
    help: values.help === true,
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function selectTasks(value: string | undefined) {
  if (value === "all") return tasks
  const ids = value
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids && ids.length > 0) {
    const unknown = ids.filter((id) => !tasks.some((task) => task.id === id))
    if (unknown.length > 0) throw new Error(`Unknown task: ${unknown.join(", ")}`)
    return tasks.filter((task) => ids.includes(task.id))
  }
  return tasks.filter((task) => task.default !== false)
}

async function readBaseline(): Promise<Baseline> {
  const commit = await sh(["git", "rev-parse", "HEAD"], repoRoot, 10_000)
  const status = await sh(["git", "status", "--porcelain"], repoRoot, 10_000)
  return {
    commit: commit.exitCode === 0 ? commit.stdout.trim() : "unknown",
    dirty: status.exitCode === 0 ? status.stdout.trim().length > 0 : false,
    bun: Bun.version,
    platform: process.platform + "-" + process.arch,
    startedAt: new Date().toISOString(),
  }
}

async function sh(
  command: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string | undefined> = { ...process.env },
): Promise<ProcessResult> {
  const started = performance.now()
  let timedOut = false
  const proc = Bun.spawn(command, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])
  clearTimeout(timer)
  return { exitCode, stdout, stderr, timedOut, durationMs: Math.round(performance.now() - started) }
}

async function writeFiles(base: string, files: Record<string, string>) {
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const target = join(base, path)
      await mkdir(dirname(target), { recursive: true })
      await Bun.write(target, content)
    }),
  )
}

async function setup(task: Task, workspace: string) {
  await rm(workspace, { recursive: true, force: true })
  await mkdir(workspace, { recursive: true })
  await writeFiles(workspace, task.files)
  const init = await sh(["git", "init", "-q"], workspace, 10_000)
  if (init.exitCode !== 0) throw new Error("git init failed: " + tail(init.stderr))
  const add = await sh(["git", "add", "-A"], workspace, 10_000)
  if (add.exitCode !== 0) throw new Error("git add failed: " + tail(add.stderr))
  const commit = await sh(
    [
      "git",
      "-c",
      "user.name=eval",
      "-c",
      "user.email=eval@opencode.local",
      "commit",
      "-qm",
      "baseline",
    ],
    workspace,
    10_000,
  )
  if (commit.exitCode !== 0) throw new Error("git commit failed: " + tail(commit.stderr))
}

function resolveBin(value: string) {
  return value.includes("/") || value.includes("\\") ? resolve(value) : value
}

function gateContent(existing: string | undefined) {
  if (!existing) return JSON.stringify({ experimental: { verification: true } })
  try {
    const parsed = JSON.parse(existing)
    return JSON.stringify({ ...parsed, experimental: { ...parsed.experimental, verification: true } })
  } catch {
    return JSON.stringify({ experimental: { verification: true } })
  }
}

type AgentInvocation = {
  command: string[]
  cwd: string
}

function agentCommand(task: Task, model: string, options: Options, workspace: string): AgentInvocation {
  const args = [
    "--standalone",
    "run",
    "--format",
    "json",
    "--auto",
    "--title",
    "eval:" + task.id,
    "--model",
    model,
    "--agent",
    options.agent,
    task.prompt,
  ]
  if (options.bin) {
    const bin = resolveBin(options.bin)
    const source = bin.endsWith(".ts")
    return {
      command: [...(source ? [process.execPath, bin] : [bin]), ...args],
      // A source entry needs the bunfig beside it; a compiled binary does not.
      cwd: source ? dirname(bin) : workspace,
    }
  }
  const cliDir = join(repoRoot, "packages/cli")
  return {
    // Run the checkout's CLI from packages/cli so its bunfig preload applies.
    command: [process.execPath, "src/index.ts", ...args],
    cwd: cliDir,
  }
}

function emptyContext(): VerifyContext {
  return { finalText: "", gitStatus: "", diff: "" }
}

async function verify(task: Task, workspace: string, context: VerifyContext): Promise<ProcessResult> {
  const verifyDir = join(workspace, "eval-verify")
  await mkdir(verifyDir, { recursive: true })
  await writeFiles(verifyDir, task.verify.files ?? {})
  await Bun.write(join(verifyDir, "final.txt"), context.finalText)
  await Bun.write(join(verifyDir, "git-status.txt"), context.gitStatus)
  await Bun.write(join(verifyDir, "diff.patch"), context.diff)
  const command = task.verify.command ?? [process.execPath, "test", "--timeout", "30000"]
  return sh(command, workspace, VERIFY_TIMEOUT_MS)
}

async function runTask(task: Task, run: number, options: Options): Promise<RunResult> {
  const model = options.model
  if (!model) throw new Error("A model is required")
  const workspace = join(workspaceRoot, task.id, "run-" + run)
  const artifactDir = join(options.out, task.id, "run-" + run)
  await mkdir(artifactDir, { recursive: true })
  await setup(task, workspace)
  const startedAt = new Date().toISOString()
  const invocation = agentCommand(task, model, options, workspace)
  const agent = await sh(invocation.command, invocation.cwd, task.timeoutMs ?? options.timeout, {
    ...process.env,
    PWD: workspace,
    OPENCODE_DISABLE_SHARE: "1",
    ...(options.gate ? { OPENCODE_CONFIG_CONTENT: gateContent(process.env.OPENCODE_CONFIG_CONTENT) } : {}),
  })
  const parsed = parseRunOutput(agent.stdout)
  const status = await sh(["git", "status", "--short"], workspace, 10_000)
  const add = await sh(["git", "add", "-A"], workspace, 10_000)
  const diff =
    add.exitCode === 0
      ? await sh(["git", "diff", "--cached", "--binary"], workspace, 20_000)
      : { exitCode: add.exitCode, stdout: "", stderr: add.stderr, timedOut: false, durationMs: 0 }
  const verification = await verify(task, workspace, {
    finalText: parsed.finalText,
    gitStatus: status.stdout,
    diff: diff.stdout,
  })
  const stdoutPath = join(artifactDir, "stdout.jsonl")
  const stderrPath = join(artifactDir, "stderr.log")
  const diffPath = join(artifactDir, "diff.patch")
  await Bun.write(stdoutPath, agent.stdout)
  await Bun.write(stderrPath, agent.stderr)
  await Bun.write(diffPath, diff.stdout)
  await Bun.write(join(artifactDir, "verification.log"), verification.stdout + verification.stderr)
  if (!options.keep) await rm(workspace, { recursive: true, force: true })

  const validCompletion = !agent.timedOut && agent.exitCode === 0 && parsed.errors.length === 0 && parsed.steps > 0
  const verified = validCompletion && verification.exitCode === 0
  const errors = [...parsed.errors]
  if (agent.timedOut) errors.push("agent timed out")
  if (!agent.timedOut && agent.exitCode !== 0 && errors.length === 0) errors.push("agent exited with code " + agent.exitCode)

  return {
    task: task.id,
    category: task.category,
    run,
    model,
    agent: options.agent,
    startedAt,
    durationMs: agent.durationMs,
    timedOut: agent.timedOut,
    exitCode: agent.exitCode,
    validCompletion,
    verified,
    verification: {
      ...verification,
      stdout: truncate(verification.stdout, 4_000),
      stderr: truncate(verification.stderr, 4_000),
    },
    usage: parsed.usage,
    steps: parsed.steps,
    toolCalls: parsed.toolCalls,
    toolErrors: parsed.toolErrors,
    errors,
    finalText: truncate(parsed.finalText, 4_000),
    diffPath,
    stdoutPath,
    stderrPath,
    ...(options.keep ? { workspace } : {}),
  }
}

function failedRun(task: Task, run: number, options: Options, error: unknown): RunResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    task: task.id,
    category: task.category,
    run,
    model: options.model ?? "unset",
    agent: options.agent,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    timedOut: false,
    exitCode: 1,
    validCompletion: false,
    verified: false,
    verification: { exitCode: 1, stdout: "", stderr: message, timedOut: false, durationMs: 0 },
    usage: zeroUsage(),
    steps: 0,
    toolCalls: 0,
    toolErrors: 0,
    errors: [message],
    finalText: "",
    diffPath: "",
    stdoutPath: "",
    stderrPath: "",
  }
}

async function runAll(selected: Task[], options: Options) {
  const results: RunResult[] = []
  const total = selected.length * options.repeat
  let index = 0
  for (const task of selected) {
    for (let run = 1; run <= options.repeat; run++) {
      index += 1
      process.stdout.write(`eval ${index}/${total} ${task.id} run ${run} `)
      const result = await runTask(task, run, options).catch((error: unknown) => failedRun(task, run, options, error))
      results.push(result)
      const label = result.verified ? "verified" : result.validCompletion ? "unverified" : "failed"
      console.log(`${label} ${(result.durationMs / 1000).toFixed(1)}s $${result.usage.cost.toFixed(4)}`)
    }
  }
  if (!options.keep) await rm(workspaceRoot, { recursive: true, force: true })
  return results
}

async function audit(selected: Task[], options: Options) {
  const out = join(options.out, "audit")
  await mkdir(out, { recursive: true })
  let ok = true
  console.log("audit: expected seeded failure and solution pass")
  for (const task of selected) {
    const seededWorkspace = join(workspaceRoot, "audit", task.id, "seeded")
    await setup(task, seededWorkspace)
    const seeded = await verify(task, seededWorkspace, emptyContext())
    await Bun.write(join(out, task.id, "seeded.stdout"), seeded.stdout)
    await Bun.write(join(out, task.id, "seeded.stderr"), seeded.stderr)
    if (!options.keep) await rm(seededWorkspace, { recursive: true, force: true })
    const seededExpected = task.seeded === false ? "pass" : "fail"
    const seededOK = seededExpected === "fail" ? seeded.exitCode !== 0 : seeded.exitCode === 0
    let solutionOK = true
    let solutionLabel = "skipped"
    if (task.solution || task.solutionFinal !== undefined) {
      const solutionWorkspace = join(workspaceRoot, "audit", task.id, "solution")
      await setup(task, solutionWorkspace)
      if (task.solution) await writeFiles(solutionWorkspace, task.solution)
      const solved = await verify(task, solutionWorkspace, {
        finalText: task.solutionFinal ?? "",
        gitStatus: "",
        diff: "",
      })
      await Bun.write(join(out, task.id, "solution.stdout"), solved.stdout)
      await Bun.write(join(out, task.id, "solution.stderr"), solved.stderr)
      if (!options.keep) await rm(solutionWorkspace, { recursive: true, force: true })
      solutionOK = solved.exitCode === 0
      solutionLabel = solutionOK ? "pass" : "FAIL " + tail(solved.stderr || solved.stdout)
    }
    const pass = seededOK && solutionOK
    ok &&= pass
    console.log(
      `${pass ? "ok  " : "FAIL"} ${task.id} seeded ${seededExpected}${seededOK ? "" : " (unexpected)"} solution ${solutionLabel}`,
    )
  }
  if (!options.keep) await rm(workspaceRoot, { recursive: true, force: true })
  return ok
}

function summarize(results: RunResult[], baseline: Baseline, options: Options, selected: Task[], startedAt: string): Report {
  const durations = results.map((result) => result.durationMs).sort((left, right) => left - right)
  const verified = results.filter((result) => result.verified).length
  const validCompletions = results.filter((result) => result.validCompletion).length
  const totalCost = results.reduce((sum, result) => sum + result.usage.cost, 0)
  const totalTokens = results.reduce((sum, result) => sum + result.usage.total, 0)
  const toolCalls = results.reduce((sum, result) => sum + result.toolCalls, 0)
  const toolErrors = results.reduce((sum, result) => sum + result.toolErrors, 0)
  const byCategory = new Map<string, CategorySummary>()
  for (const result of results) {
    const current = byCategory.get(result.category) ?? { category: result.category, runs: 0, verified: 0, cost: 0 }
    current.runs += 1
    current.verified += result.verified ? 1 : 0
    current.cost += result.usage.cost
    byCategory.set(result.category, current)
  }
  return {
    baseline,
    config: {
      model: options.model ?? "unset",
      agent: options.agent,
      repeat: options.repeat,
      timeoutMs: options.timeout,
      gate: options.gate,
      tasks: selected.map((task) => task.id),
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    runs: results.length,
    verified,
    validCompletions,
    verifiedSuccessRate: rate(verified, results.length),
    validCompletionRate: rate(validCompletions, results.length),
    totalCost,
    costPerVerifiedSuccess: verified === 0 ? null : totalCost / verified,
    medianDurationMs: percentile(durations, 0.5),
    p90DurationMs: percentile(durations, 0.9),
    totalTokens,
    toolCalls,
    toolErrors,
    toolErrorRate: rate(toolErrors, toolCalls),
    byCategory: Array.from(byCategory.values()).sort((left, right) => left.category.localeCompare(right.category)),
    results,
  }
}

function renderSummary(report: Report) {
  const lines = [
    "# Harness eval",
    "",
    `- Baseline: \`${report.baseline.commit}\`${report.baseline.dirty ? " (dirty)" : ""}`,
    `- Bun: ${report.baseline.bun} (${report.baseline.platform})`,
    `- Model: \`${report.config.model}\``,
    `- Agent: \`${report.config.agent}\``,
    `- Runs: ${report.runs} across ${report.config.tasks.length} tasks`,
    `- Verified: ${report.verified}/${report.runs} (${percent(report.verifiedSuccessRate)})`,
    `- Valid completion: ${report.validCompletions}/${report.runs} (${percent(report.validCompletionRate)})`,
    `- Cost: $${report.totalCost.toFixed(4)}; per verified success: ${report.costPerVerifiedSuccess === null ? "n/a" : "$" + report.costPerVerifiedSuccess.toFixed(4)}`,
    `- Time: median ${(report.medianDurationMs / 1000).toFixed(1)}s, p90 ${(report.p90DurationMs / 1000).toFixed(1)}s`,
    `- Tokens: ${report.totalTokens}; tools: ${report.toolCalls} calls, ${report.toolErrors} errors (${percent(report.toolErrorRate)})`,
    "",
    "| Task | Category | Verified | Valid | Time | Cost | Steps | Tools | Errors |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
  ]
  for (const result of report.results) {
    lines.push(
      `| ${result.task} | ${result.category} | ${result.verified ? "yes" : "no"} | ${result.validCompletion ? "yes" : "no"} | ${(result.durationMs / 1000).toFixed(1)}s | $${result.usage.cost.toFixed(4)} | ${result.steps} | ${result.toolCalls} | ${result.errors.length} |`,
    )
  }
  const failures = report.results.filter((result) => !result.verified)
  if (failures.length > 0) {
    lines.push("", "## Failures", "")
    for (const result of failures) {
      const detail =
        result.errors[0] ??
        result.verification.stderr.trim().split("\n").slice(-1)[0] ??
        "verification failed"
      lines.push(`- \`${result.task}\` run ${result.run}: ${detail}`)
    }
  }
  lines.push(
    "",
    "This is a synthetic smoke suite. It is not a leaderboard, and one run per task does not establish a stable difference.",
    "",
  )
  return lines.join("\n")
}

async function writeReport(report: Report, out: string) {
  await Bun.write(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n")
  await Bun.write(join(out, "summary.md"), renderSummary(report))
  console.log("")
  console.log(
    `verified ${report.verified}/${report.runs} (${percent(report.verifiedSuccessRate)}), cost $${report.totalCost.toFixed(4)}`,
  )
  console.log(`report ${join(out, "report.json")}`)
}

function zeroUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 }
}

function percentile(values: number[], point: number) {
  if (values.length === 0) return 0
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(point * values.length) - 1))
  return values[index] ?? 0
}

function rate(value: number, total: number) {
  return total === 0 ? 0 : value / total
}

function percent(value: number) {
  return (value * 100).toFixed(1) + "%"
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : value.slice(0, length) + "\n... (truncated)"
}

function tail(value: string, length = 600) {
  const text = value.trim()
  return text.length <= length ? text : "..." + text.slice(-length)
}

function printTasks(selected: Task[]) {
  for (const task of selected) {
    console.log(`${task.id.padEnd(20)} ${task.category.padEnd(16)} ${task.default === false ? "excluded" : "default"}`)
  }
}

function printHelp() {
  console.log(
    [
      "Usage: bun run eval/run.ts --model <provider/model> [options]",
      "",
      "Options:",
      "  -m, --model <id>          Provider/model to evaluate (required for a run)",
      "  -a, --agent <id>          Agent passed to opencode run (default: build)",
      "  -t, --tasks <ids>         Comma-separated task ids, or 'all' (default: default tasks)",
      "      --repeat <n>          Runs per task (default: 1)",
      "      --timeout <ms>        Per-run timeout (default: 600000)",
      "      --out <dir>           Output directory (default: eval/.runs/<timestamp>)",
      "      --bin <path>          opencode executable or .ts entry point (default: this checkout)",
      "      --keep                Keep the disposable workspaces",
      "      --gate                Enable the experimental turn verification gate",
      "      --fail-on-unverified  Exit 1 if any run is not verified",
      "      --list                List selected tasks",
      "      --audit               Verify seeded tasks fail and solutions pass; no model needed",
      "      --dry-run             Print the baseline and selected tasks without running",
      "  -h, --help                Show this help",
    ].join("\n"),
  )
}

const options = parseOptions()
if (options.help) {
  printHelp()
  process.exit(0)
}

let selected: Task[]
try {
  selected = selectTasks(options.tasks)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
if (selected.length === 0) {
  console.error("No tasks selected")
  process.exit(2)
}
if (options.list) {
  printTasks(selected)
  process.exit(0)
}

const baseline = await readBaseline()
if (options.dryRun) {
  console.log(`baseline ${baseline.commit}${baseline.dirty ? " (dirty)" : ""}`)
  console.log(`bun ${baseline.bun} ${baseline.platform}`)
  console.log(`model ${options.model ?? "(not set)"}`)
  console.log(`agent ${options.agent}`)
  console.log(`out ${options.out}`)
  console.log(`tasks ${selected.length}: ${selected.map((task) => task.id).join(", ")}`)
  process.exit(0)
}
if (options.audit) {
  const ok = await audit(selected, options)
  process.exit(ok ? 0 : 1)
}
if (!options.model) {
  console.error("--model is required for an eval run")
  printHelp()
  process.exit(2)
}

await mkdir(options.out, { recursive: true })
const startedAt = new Date().toISOString()
const results = await runAll(selected, options)
const report = summarize(results, baseline, options, selected, startedAt)
await writeReport(report, options.out)
process.exit(options.failOnUnverified && report.verified !== report.runs ? 1 : 0)
