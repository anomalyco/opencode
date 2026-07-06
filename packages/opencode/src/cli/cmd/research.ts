import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

// ---------------------------------------------------------------------------
// Template for program.md — the instruction file the agent reads
// Based on Karpathy's autoresearch pattern, but generalized for code research.
// ---------------------------------------------------------------------------

function programMD(goal: string): string {
  return `# Autoresearch

This is an experiment in autonomous research. You (the AI agent) will iterate
on research artifacts to improve a measurable score. The human supervises at
the meta level (this file). You do the actual work.

## Research Goal

${goal}

## Setup

1. Read this file completely.
2. Read \`eval/eval.sh\` to understand how scoring works. **Do not modify eval/**.
3. Read the current state of \`target/\` — this is what you will iterate on.
4. Read \`results.tsv\` (if it exists) to see prior experiment history.
5. Initialize \`results.tsv\` with the header row if missing.
6. Establish a baseline: run \`bash eval/eval.sh\` and record the score.

## What You Can Do

- Modify any file inside \`target/\` — this is your sandbox. Architecture,
  implementation, parameters, everything is fair game.
- Create new files inside \`target/\`.
- Run \`bash eval/eval.sh\` at any time to measure performance.
- Run shell commands to test your changes (compile, lint, test, benchmark).

## What You Cannot Do

- Modify anything inside \`eval/\`. These files are read-only.
- Modify \`program.md\`.
- Install new system packages without asking.
- Modify \`results.tsv\` directly — the scoring function outputs to it.

## The Metric

\`eval/eval.sh\` outputs a single floating-point number to stdout.
LOWER is better (like loss). The first line of stdout is the score.
If the script fails (non-zero exit), the experiment is a crash.

## Output Format

Results are logged in \`results.tsv\` (tab-separated). Columns:
- \`commit\` — git commit hash (7 chars) or "none" if not versioned
- \`score\` — the metric value (use 999.0 for crashes)
- \`status\` — \`keep\`, \`discard\`, or \`crash\`
- \`description\` — what this experiment tried

## The Experiment Loop

LOOP FOREVER:

1. Review the current state and past results.
2. Form a hypothesis: what change might improve the score?
3. Implement the change in \`target/\`.
4. (If git is available) \`git commit -am "experiment: <description>"\`
5. Run the evaluation: \`bash eval/eval.sh\`
6. Read the score from stdout.
7. Log the result in \`results.tsv\`.
8. If the score improved (decreased), keep the change and advance.
9. If the score is equal or worse, revert the change.
   - If git: \`git reset --hard HEAD~1\`
   - If no git: manually undo the change
10. Go to step 1.

## Guidelines

- **Never stop**. The loop runs until you are manually interrupted.
- **If you run out of ideas**, read more, try combinations of previous approaches,
  or make more radical changes.
- **Crashes**: If eval fails, fix obvious bugs and retry. If the idea is
  fundamentally broken, discard and move on.
- **Simplicity**: All else equal, simpler is better. A big improvement that
  adds ugly complexity is worth less than a small improvement from clean code.
- **Timeout**: If an experiment takes more than 10 minutes, kill it and treat
  as a crash.
- **You are autonomous**. Do not ask the human if you should continue.
  Do not ask permission. The human may be asleep. Keep going.
`
}

// ---------------------------------------------------------------------------
// Template for eval/eval.sh — the scoring harness
// ---------------------------------------------------------------------------

const evalShTemplate = `#!/bin/bash
# eval/eval.sh — Scoring harness for autoresearch
#
# Output: a single floating-point score to stdout (lower is better).
# Exit 0 on success, non-zero on crash.
#
# IMPORTANT: This file is read-only. The agent must NOT modify it.

# Default: measure target/ directory size as a proxy for complexity.
# Replace this with your actual evaluation logic.
# Examples:
#   - Compile and count warnings
#   - Run tests and measure pass rate
#   - Benchmark execution time
#   - Lint and count issues

# Example: count lines of code in target/ (lower is better for simplicity)
find target/ -type f \\( -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.go" -o -name "*.rs" -o -name "*.md" \\) 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}'

# Alternative example: run a test suite and extract a score
# cd target && npm test 2>&1 | grep -oP 'tests: \\\\d+' | grep -oP '\\\\d+'
`

// ---------------------------------------------------------------------------
// Template README for the research workspace
// ---------------------------------------------------------------------------

const readmeTemplate = (goal: string) => `# Autoresearch Workspace

**Goal**: ${goal}

## Structure

- \`program.md\` — instructions for the AI agent (human-edited)
- \`target/\` — the artifact being optimized (agent modifies this)
- \`eval/eval.sh\` — scoring harness (read-only, do not modify)
- \`results.tsv\` — experiment log

## Usage

\`\`\`bash
# Start the research loop
./start.sh
\`\`\`

Edit \`program.md\` and \`eval/eval.sh\` to customize the research direction.
`

const startShTemplate = `#!/bin/bash
# start.sh — Enter the autoresearch loop
set -euo pipefail
cd "$(dirname "$0")"
echo "Starting autoresearch loop. Press Ctrl+C to stop."
echo "Goal: $(head -1 program.md | sed 's/^# //')"
echo ""
opencode run --auto --agent build "I am an autonomous researcher. Read program.md and start the experiment loop. Never stop until interrupted."
`

// ---------------------------------------------------------------------------
// Scaffold a research workspace
// ---------------------------------------------------------------------------

async function scaffoldWorkspace(dir: string, goal: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises")
  const path = await import("path")
  const root = path.resolve(dir)

  await mkdir(path.join(root, "target"), { recursive: true })
  await mkdir(path.join(root, "eval"), { recursive: true })

  await writeFile(path.join(root, "program.md"), programMD(goal), "utf-8")
  await writeFile(path.join(root, "eval", "eval.sh"), evalShTemplate, "utf-8")
  await writeFile(path.join(root, "start.sh"), startShTemplate, "utf-8")
  await writeFile(path.join(root, "README.md"), readmeTemplate(goal), "utf-8")

  // Create empty results.tsv with header
  const tsvHeader = "commit\tscore\tstatus\tdescription" + EOL
  await writeFile(path.join(root, "results.tsv"), tsvHeader, "utf-8")

  // Create .gitkeep in target
  await writeFile(path.join(root, "target", ".gitkeep"), "", "utf-8")

  // Make scripts executable
  const { chmod } = await import("node:fs/promises")
  await chmod(path.join(root, "eval", "eval.sh"), 0o755)
  await chmod(path.join(root, "start.sh"), 0o755)
}

// ---------------------------------------------------------------------------
// The opencode research command
// ---------------------------------------------------------------------------

export const ResearchCommand = effectCmd({
  command: "research [query..]",
  describe: "set up and run autonomous research (autoresearch pattern)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("query", {
        describe: "research goal or topic",
        type: "string",
        array: true,
      })
      .option("dir", {
        type: "string",
        describe: "workspace directory (default: ./.autoresearch)",
        default: ".autoresearch",
      })
      .option("goal", {
        type: "string",
        describe: "research goal (if not provided via query)",
      }),
  handler: Effect.fn("Cli.research")(function* (args) {
    const goal = args.goal || args.query?.join(" ") || ""
    if (!goal) {
      return yield* fail(
        "Provide a research goal. Usage: opencode research [--goal <goal>] <query>",
      )
    }

    const path = yield* Effect.promise(() => import("path"))
    const dir = path.resolve(args.dir)
    const { mkdir } = yield* Effect.promise(() => import("node:fs/promises"))
    const { existsSync } = yield* Effect.promise(() => import("node:fs"))

    // Scaffold workspace
    if (!existsSync(dir)) {
      yield* Effect.promise(() => mkdir(dir, { recursive: true }))
      yield* Effect.promise(() => scaffoldWorkspace(dir, goal))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓" + UI.Style.TEXT_NORMAL + " Research workspace created at " + dir)
    } else {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL + " Using existing workspace at " + dir)
    }

    UI.empty()
    UI.println("Goal: " + goal)
    UI.println("Program: " + path.join(dir, "program.md"))
    UI.println("Target:  " + path.join(dir, "target/"))
    UI.println("Eval:    " + path.join(dir, "eval/eval.sh"))
    UI.empty()

    // Launch the research agent
    UI.println("Launching research agent... (Ctrl+C to stop)")
    UI.empty()

    // Use opencode run to start the agent with program.md
    // We spawn a child process rather than using the SDK directly for simplicity.
    const { spawn } = yield* Effect.promise(() => import("node:child_process"))

    yield* Effect.async<void>((resume) => {
      const child = spawn("opencode", ["run", "--auto", "--agent", "build", "--dir", dir], {
        stdio: "inherit",
        env: {
          ...process.env,
          OPENCODE_AUTORESEARCH_GOAL: goal,
        },
      })

      child.on("exit", (code) => {
        if (code === 0 || code === 130 || code === 143) {
          // Normal exit, SIGINT, or SIGTERM
          resume(Effect.void)
        } else {
          UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL + ` Research agent exited with code ${code}`)
          resume(Effect.void)
        }
      })

      child.on("error", (err) => {
        UI.error("Failed to launch research agent: " + err.message)
        resume(Effect.void)
      })
    })
  }),
})
