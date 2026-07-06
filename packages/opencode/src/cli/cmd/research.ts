import { EOL } from "os"
import path from "path"
import { mkdir, writeFile, chmod } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

// ---------------------------------------------------------------------------
// program.md — the instruction file the agent follows
// Based on Karpathy's autoresearch (modify → experiment → measure → loop).
// ---------------------------------------------------------------------------

function programMD(goal: string): string {
  return `# Autoresearch

You are an autonomous researcher. Your job: iterate on \`target/\` to improve
a measurable score. The human edits this file; you do the actual work.

## Research Goal

${goal}

## Setup

1. Read this file and \`eval/eval.sh\` completely.
2. Read \`target/\` — this is what you will iterate on.
3. Read \`results.tsv\` if it exists (prior experiment history).
4. **Establish a baseline**: run \`bash eval/eval.sh\` and record the score.
5. You are now ready to experiment. Never stop until interrupted.

## What You Can Do

- Modify any file inside \`target/\` — architecture, implementation, params.
- Create new files inside \`target/\`.
- Run \`bash eval/eval.sh\` at any time to get the current score.
- Run any shell command to test your changes (compile, lint, benchmark).

## What You Cannot Do

- Modify anything inside \`eval/\`. These files are read-only.
- Modify \`program.md\`.
- Install new system packages.

## The Metric

\`eval/eval.sh\` outputs a single float to stdout (first line). **Lower is better**.
If the script exits non-zero, the experiment is a crash (score = 999.0).

## Results

Log every experiment in \`results.tsv\` (tab-separated):
- \`commit\` — git hash or "none"
- \`score\` — metric value (999.0 for crashes)
- \`status\` — \`keep\`, \`discard\`, or \`crash\`
- \`description\` — what you tried

## Experiment Loop

LOOP FOREVER:

1. Review state + past results.
2. Form a hypothesis: what change might improve the score?
3. Implement it in \`target/\`.
4. (Optional) \`git commit -am "experiment: <desc>"\`.
5. Run \`bash eval/eval.sh\` and capture the score.
6. Log the result in \`results.tsv\`.
7. If score improved → keep the change and advance.
8. If score regressed → revert (\`git reset --hard HEAD~1\` or manual undo).
9. Go to step 1.

## Guidelines

- **Never stop**. You are autonomous. The human may be asleep.
- **Run out of ideas?** Combine near-misses, try radical changes, re-read prior results.
- **Crashes**: fix obvious bugs and retry; if fundamentally broken, discard.
- **Simplicity**: simpler is better. A small improvement with clean code beats a large one with hacky code.
- **Timeout**: kill experiments exceeding 10 minutes, treat as crash.
`
}

const evalShTemplate = `#!/bin/bash
# eval/eval.sh — Scoring harness. Outputs a single float to stdout (lower=better).
# Exit 0 on success, non-zero on crash. This file is read-only.
#
# Customize this for your specific research task. Examples:
#   - Compile and count warnings
#   - Run tests, measure pass rate
#   - Benchmark execution time
#   - Lint and count issues

# Default: count lines of code in target/ (simplicity metric)
find target/ -type f \\( -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.go" -o -name "*.rs" -o -name "*.md" \\) 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}'
`

const startShTemplate = `#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Autoresearch loop starting. Ctrl+C to stop."
echo "Goal: $(sed -n '1s/^# //p' program.md)"
echo ""
opencode run --auto --agent build "I am an autonomous researcher. Read program.md and start the experiment loop. Never stop until interrupted."
`

// ---------------------------------------------------------------------------
// Scaffold a research workspace with template files
// ---------------------------------------------------------------------------

async function scaffoldWorkspace(dir: string, goal: string): Promise<void> {
  const root = path.resolve(dir)
  await mkdir(path.join(root, "target"), { recursive: true })
  await mkdir(path.join(root, "eval"), { recursive: true })
  await writeFile(path.join(root, "program.md"), programMD(goal), "utf-8")
  await writeFile(path.join(root, "eval", "eval.sh"), evalShTemplate, "utf-8")
  await writeFile(path.join(root, "start.sh"), startShTemplate, "utf-8")

  const readme = `# Autoresearch: ${goal}\n\nSee \`program.md\` for instructions.\n`
  await writeFile(path.join(root, "README.md"), readme, "utf-8")
  await writeFile(path.join(root, "results.tsv"), "commit\tscore\tstatus\tdescription" + EOL, "utf-8")
  await writeFile(path.join(root, "target", ".gitkeep"), "", "utf-8")
  await chmod(path.join(root, "eval", "eval.sh"), 0o755)
  await chmod(path.join(root, "start.sh"), 0o755)
}

// ---------------------------------------------------------------------------
// Run a baseline eval after scaffolding, so the user sees an initial score
// ---------------------------------------------------------------------------

async function runBaseline(dir: string): Promise<void> {
  const { execSync } = await import("node:child_process")
  try {
    const score = execSync("bash eval/eval.sh", { cwd: dir, encoding: "utf-8", timeout: 30000 })
      .split(EOL)[0]
      .trim()
    const line = `none\t${score}\tkeep\tbaseline (initial)` + EOL
    await writeFile(path.join(dir, "results.tsv"), `commit\tscore\tstatus\tdescription` + EOL + line, "utf-8")
    UI.println("  Baseline score: " + score)
  } catch {
    UI.println(UI.Style.TEXT_WARNING_BOLD + "  !" + UI.Style.TEXT_NORMAL + " Baseline eval failed (customize eval/eval.sh for your task)")
  }
}

// ---------------------------------------------------------------------------
// The research command
// ---------------------------------------------------------------------------

export const ResearchCommand = effectCmd({
  command: "research [query..]",
  describe: "autonomous research loop (autoresearch pattern)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("query", {
        describe: "research goal",
        type: "string",
        array: true,
      })
      .option("dir", {
        type: "string",
        describe: "workspace directory",
        default: ".autoresearch",
      })
      .option("goal", {
        type: "string",
        describe: "research goal (if not provided via query)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use for the research agent",
      })
      .option("agent", {
        alias: "a",
        type: "string",
        describe: "agent to use (default: build)",
        default: "build",
      })
      .option("baseline", {
        type: "boolean",
        describe: "run baseline eval after scaffolding",
        default: true,
      }),
  handler: Effect.fn("Cli.research")(function* (args) {
    const goal = args.goal || args.query?.join(" ") || ""
    if (!goal) {
      return yield* fail(
        "Usage: opencode research <goal>\n" +
        "       opencode research --goal \"optimize X\"\n" +
        "       opencode research --dir ./my-lab \"research topic\"",
      )
    }

    const dir = path.resolve(args.dir)
    const isNew = !existsSync(dir)

    if (isNew) {
      yield* Effect.promise(() => scaffoldWorkspace(dir, goal))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓" + UI.Style.TEXT_NORMAL + " Created " + dir)
      if (args.baseline) {
        yield* Effect.promise(() => runBaseline(dir))
      }
    } else {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL + " Using existing workspace " + dir)
    }

    UI.empty()
    UI.println("  goal:    " + goal)
    UI.println("  program: " + path.join(dir, "program.md"))
    UI.println("  target:  " + path.join(dir, "target/"))
    UI.println("  eval:    " + path.join(dir, "eval/eval.sh"))
    UI.println("  results: " + path.join(dir, "results.tsv"))
    UI.empty()

    // Build opencode run args
    const runArgs = ["run", "--auto", "--agent", args.agent, "--dir", dir]
    if (args.model) {
      runArgs.push("--model", args.model)
    }
    runArgs.push("I am an autonomous researcher. Read program.md and start the experiment loop. Never stop until interrupted.")

    UI.println("Launching research agent... (Ctrl+C to stop)")
    UI.empty()

    yield* Effect.async<void>((resume) => {
      const child = spawn("opencode", runArgs, {
        stdio: "inherit",
        env: { ...process.env, OPENCODE_RESEARCH_GOAL: goal },
      })
      child.on("exit", (code) => {
        if (code === 0 || code === 130 || code === 143) {
          resume(Effect.void)
        } else {
          UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL + ` Agent exited with code ${code}`)
          resume(Effect.void)
        }
      })
      child.on("error", (err) => {
        UI.error("Failed to launch agent: " + err.message)
        resume(Effect.void)
      })
    })
  }),
})
