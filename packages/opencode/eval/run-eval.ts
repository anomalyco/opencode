#!/usr/bin/env bun
// Core eval harness: runs opencode against each task on a given branch,
// captures the diff, runs verify, and records results.
//
// Usage:
//   bun run eval/run-eval.ts --model anthropic/claude-sonnet-4-20250514
//   bun run eval/run-eval.ts --model openai/gpt-5 --branch dev
//   bun run eval/run-eval.ts --model anthropic/claude-sonnet-4-20250514 --tasks 001,002

import { parseArgs } from "util"
import { $ } from "bun"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const EVAL_DIR = import.meta.dir
const REPO_ROOT = path.resolve(EVAL_DIR, "../../..")
const TASKS_FILE = path.join(EVAL_DIR, "tasks.jsonl")
const RESULTS_DIR = path.join(EVAL_DIR, "results")

type Task = {
  id: string
  name: string
  dir: string
  commit: string
  base_sha: string
  package: string
  verify_cmd: string
}

type TaskResult = {
  task_id: string
  task_name: string
  branch: string
  model: string
  passed: boolean
  diff_lines: number
  wall_clock_ms: number
  tool_calls: number
  error?: string
  agent_diff?: string
}

function loadTasks(filter?: string[]): Task[] {
  const raw = fs.readFileSync(TASKS_FILE, "utf8")
  const tasks = raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Task)
  if (filter && filter.length > 0) {
    return tasks.filter((t) => filter.includes(t.id))
  }
  return tasks
}

async function runTask(task: Task, model: string, branch: string): Promise<TaskResult> {
  const workDir = path.join(os.tmpdir(), `oc-eval-${task.id}-${Date.now()}`)
  const start = Date.now()

  try {
    // Create worktree at the branch tip (so the agent must apply fixes)
    await $`git worktree add --detach ${workDir} ${branch}`.cwd(REPO_ROOT)

    // Read the prompt
    const prompt = fs.readFileSync(path.join(EVAL_DIR, task.dir, "prompt.md"), "utf8")

    // Run opencode with --format json from repo root (for deps) but --dir points to worktree
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "--conditions=browser",
        path.join(REPO_ROOT, "packages/opencode/src/index.ts"),
        "run",
        "--model",
        model,
        "--dir",
        workDir,
        "--format",
        "json",
        "--dangerously-skip-permissions",
        prompt,
      ],
      {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_DISABLE_AUTOCOMPACT: "1",
          HOME: os.homedir(),
        },
      },
    )

    const TIMEOUT_MS = 180_000 // 3 minutes per task
    const stdoutPromise = new Response(proc.stdout).text()
    const stderrPromise = new Response(proc.stderr).text()

    const timer = setTimeout(() => {
      try { proc.kill("SIGTERM") } catch {}
    }, TIMEOUT_MS)

    const stdout = await stdoutPromise
    const stderr = await stderrPromise
    const exitCode = await proc.exited
    clearTimeout(timer)

    // Parse JSON events for tool call counting
    let toolCalls = 0
    const stdoutLines = stdout.split("\n")
    for (const line of stdoutLines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === "tool_use") toolCalls++
      } catch {
        // non-JSON line, ignore
      }
    }

    if (toolCalls === 0 && stdoutLines.length > 0) {
      console.error(`  [debug] stdout has ${stdoutLines.length} lines, first: ${stdoutLines[0]?.slice(0, 100)}`)
    }
    if (toolCalls === 0) {
      console.error(`  [debug] stderr: ${stderr.slice(-300)}`)
      console.error(`  [debug] exitCode: ${exitCode}`)
    }

    // Capture the agent's diff
    const diffProc = Bun.spawn(["git", "diff"], { cwd: workDir, stdout: "pipe", stderr: "pipe" })
    const diff = await new Response(diffProc.stdout).text()
    await diffProc.exited

    const diffLines = diff.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-")).filter((l) => !l.startsWith("+++") && !l.startsWith("---")).length

    // Run the verify script
    const verifyScript = path.join(EVAL_DIR, task.dir, "verify.sh")
    let passed = false
    let verifyError: string | undefined

    // Apply fix commit's patch to verify agent's fix works (for pre-fix runs)
    const verifyFix = process.env.EVAL_VERIFY_FIX === "1"
    if (verifyFix) {
      try {
        const patchProc = Bun.spawn(
          ["git", "diff", `${task.commit}^`, `${task.commit}`],
          { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
        )
        const patch = await new Response(patchProc.stdout).text()
        await patchProc.exited
        if (patch.trim()) {
          const applyProc = Bun.spawn(["git", "apply"], {
            cwd: workDir,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          })
          applyProc.stdin.write(patch)
          applyProc.stdin.end()
          await applyProc.exited
        }
      } catch {
        // patch application is best-effort
      }
    }

    if (fs.existsSync(verifyScript)) {
      try {
        const verifyProc = Bun.spawn(["bash", verifyScript], {
          cwd: workDir,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            HOME: os.homedir(),
            EVAL_REPO_ROOT: REPO_ROOT,
          },
        })
        const verifyStdout = await new Response(verifyProc.stdout).text()
        const verifyStderr = await new Response(verifyProc.stderr).text()
        const verifyExit = await verifyProc.exited
        passed = verifyExit === 0
        if (!passed) {
          verifyError = `exit ${verifyExit}: ${(verifyStdout + verifyStderr).slice(-500)}`
        }
      } catch (err) {
        verifyError = String(err)
      }
    }

    return {
      task_id: task.id,
      task_name: task.name,
      branch,
      model,
      passed,
      diff_lines: diffLines,
      wall_clock_ms: Date.now() - start,
      tool_calls: toolCalls,
      error: verifyError,
      agent_diff: diff,
    }
  } catch (err) {
    return {
      task_id: task.id,
      task_name: task.name,
      branch,
      model,
      passed: false,
      diff_lines: 0,
      wall_clock_ms: Date.now() - start,
      tool_calls: 0,
      error: String(err),
    }
  } finally {
    // Cleanup worktree
    try {
      await $`git worktree remove --force ${workDir}`.cwd(REPO_ROOT)
    } catch {
      // ignore cleanup errors
    }
  }
}

function printResults(results: TaskResult[]) {
  console.log("\n" + "=".repeat(100))
  console.log("EVAL RESULTS")
  console.log("=".repeat(100))

  const passed = results.filter((r) => r.passed).length
  const total = results.length
  const totalMs = results.reduce((sum, r) => sum + r.wall_clock_ms, 0)

  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL"
    const time = (r.wall_clock_ms / 1000).toFixed(1)
    console.log(`  [${status}] ${r.task_id} ${r.task_name}  diff=${r.diff_lines} lines  tools=${r.tool_calls}  time=${time}s`)
    if (r.error) {
      console.log(`         error: ${r.error.slice(0, 200)}`)
    }
  }

  console.log("-".repeat(100))
  console.log(`  Pass rate: ${passed}/${total} (${((passed / total) * 100).toFixed(0)}%)`)
  console.log(`  Total time: ${(totalMs / 1000).toFixed(1)}s`)
  console.log(`  Model: ${results[0]?.model}`)
  console.log(`  Branch: ${results[0]?.branch}`)
  console.log("=".repeat(100))
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      model: { type: "string", required: true },
      branch: { type: "string", default: "dev" },
      tasks: { type: "string" },
      parallel: { type: "boolean", default: false },
    },
  })

  const model = values.model!
  const branch = values.branch!
  const taskFilter = values.tasks?.split(",")
  const parallel = values.parallel

  const tasks = loadTasks(taskFilter)
  console.log(`Running ${tasks.length} tasks on branch "${branch}" with model "${model}"`)
  console.log(`Mode: ${parallel ? "parallel" : "sequential"}`)

  let results: TaskResult[]

  if (parallel) {
    results = await Promise.all(tasks.map((t) => runTask(t, model, branch)))
  } else {
    results = []
    for (const task of tasks) {
      console.log(`\n--- Running task ${task.id}: ${task.name} ---`)
      const result = await runTask(task, model, branch)
      results.push(result)
      const status = result.passed ? "PASS" : "FAIL"
      console.log(`[${status}] ${task.name} (${(result.wall_clock_ms / 1000).toFixed(1)}s)`)
    }
  }

  // Save results
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const resultsFile = path.join(RESULTS_DIR, `${branch.replace("/", "-")}-${model.replace("/", "-")}-${timestamp}.json`)
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2))
  console.log(`\nResults saved to ${resultsFile}`)

  printResults(results)

  // Exit with non-zero if any task failed
  const allPassed = results.every((r) => r.passed)
  process.exit(allPassed ? 0 : 1)
}

main()
