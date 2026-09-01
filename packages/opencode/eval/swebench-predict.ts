#!/usr/bin/env bun
// SWE-bench adapter: runs opencode against SWE-bench Lite instances and
// produces predictions.jsonl for the SWE-bench evaluation harness.
//
// Usage:
//   bun run eval/swebench-predict.ts --model anthropic/claude-sonnet-4-20250514
//   bun run eval/swebench-predict.ts --model openai/gpt-5 --max 50
//
// Prerequisites:
//   pip install -e <swe-bench-repo>
//   swe-bench images build verified
//
// Output:
//   eval/results/swebench-predictions.jsonl

import { parseArgs } from "util"
import { $ } from "bun"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const EVAL_DIR = import.meta.dir
const REPO_ROOT = path.resolve(EVAL_DIR, "../..")
const RESULTS_DIR = path.join(EVAL_DIR, "results")

type SWEBenchInstance = {
  instance_id: string
  repo: string
  base_commit: string
  problem_statement: string
  hints_text: string
  patch: string
  test_patch: string
}

async function loadInstances(max?: number): Promise<SWEBenchInstance[]> {
  // Try to load from swe-bench data
  const possiblePaths = [
    path.join(os.homedir(), ".cache/swe-bench/verified.jsonl"),
    "/tmp/swe-bench/verified.jsonl",
    path.join(os.homedir(), "swe-bench/data/verified.jsonl"),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8")
      const instances = raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as SWEBenchInstance)
      return max ? instances.slice(0, max) : instances
    }
  }

  // Generate from git log as fallback (local repo tasks)
  console.log("SWE-bench data not found. Generating local task set from eval/tasks.jsonl...")
  const tasksFile = path.join(EVAL_DIR, "tasks.jsonl")
  if (!fs.existsSync(tasksFile)) {
    console.error("No SWE-bench data or local tasks.jsonl found.")
    console.error("Install SWE-bench: git clone https://github.com/swe-bench/SWE-bench.git && pip install -e SWE-bench")
    process.exit(1)
  }

  const raw = fs.readFileSync(tasksFile, "utf8")
  const tasks = raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))

  return tasks.map((t) => ({
    instance_id: `opencode__opencode-${t.id}`,
    repo: "BrandonRaeder/TeamOptiOpencode2",
    base_commit: t.base_sha,
    problem_statement: fs.readFileSync(path.join(EVAL_DIR, t.dir, "prompt.md"), "utf8"),
    hints_text: "",
    patch: "",
    test_patch: "",
  }))
}

async function runInstance(
  instance: SWEBenchInstance,
  model: string,
): Promise<{ instance_id: string; model_patch: string; model_name_or_path: string }> {
  const workDir = path.join(os.tmpdir(), `oc-swebench-${instance.instance_id.replace(/[^a-z0-9]/g, "-")}-${Date.now()}`)

  try {
    // Clone or checkout the repo at the base commit
    await $`git worktree add --detach ${workDir} ${instance.base_commit}`.cwd(REPO_ROOT)

    // Run opencode
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "--conditions=browser",
        path.join(REPO_ROOT, "packages/opencode/src/index.ts"),
        "run",
        "--model",
        model,
        "--format",
        "json",
        "--dangerously-skip-permissions",
        instance.problem_statement,
      ],
      {
        cwd: workDir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          OPENCODE_DISABLE_PROJECT_CONFIG: "1",
          OPENCODE_PURE: "1",
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_DISABLE_AUTOCOMPACT: "1",
          OPENCODE_DISABLE_MODELS_FETCH: "1",
          HOME: os.homedir(),
        },
      },
    )

    // Wait for completion (10 min timeout per instance)
    const timeout = setTimeout(() => {
      proc.kill()
    }, 600_000)

    await proc.exited
    clearTimeout(timeout)

    // Capture the diff
    const diffProc = Bun.spawn(["git", "diff"], { cwd: workDir, stdout: "pipe", stderr: "pipe" })
    const patch = await new Response(diffProc.stdout).text()
    await diffProc.exited

    return {
      instance_id: instance.instance_id,
      model_patch: patch,
      model_name_or_path: model,
    }
  } finally {
    try {
      await $`git worktree remove --force ${workDir}`.cwd(REPO_ROOT)
    } catch {
      // ignore
    }
  }
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      model: { type: "string", required: true },
      max: { type: "string" },
      parallel: { type: "string", default: "4" },
    },
  })

  const model = values.model!
  const max = values.max ? Number(values.max) : undefined
  const parallel = Number(values.parallel)

  console.log(`Loading SWE-bench instances${max ? ` (max: ${max})` : ""}...`)
  const instances = await loadInstances(max)
  console.log(`Running ${instances.length} instances with model "${model}" (${parallel} concurrent)`)

  const results: Awaited<ReturnType<typeof runInstance>>[] = []

  // Process in batches
  for (let i = 0; i < instances.length; i += parallel) {
    const batch = instances.slice(i, i + parallel)
    console.log(`\nBatch ${Math.floor(i / parallel) + 1}/${Math.ceil(instances.length / parallel)}: instances ${i + 1}-${Math.min(i + parallel, instances.length)}`)

    const batchResults = await Promise.all(batch.map((inst) => runInstance(inst, model)))
    results.push(...batchResults)

    const passed = batchResults.filter((r) => r.model_patch.trim().length > 0).length
    console.log(`  ${passed}/${batch.length} produced patches`)
  }

  // Write predictions.jsonl
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const outputPath = path.join(RESULTS_DIR, "swebench-predictions.jsonl")
  const output = results.map((r) => JSON.stringify(r)).join("\n") + "\n"
  fs.writeFileSync(outputPath, output)

  console.log(`\nPredictions written to ${outputPath}`)
  console.log(`To evaluate, run:`)
  console.log(`  swebench eval verified -p ${outputPath} --run-id opencode-eval -j ${parallel}`)
}

main()
