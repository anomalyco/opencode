import os from "node:os"
import path from "node:path"
import { Effect, Exit } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

/** Summarize a series of duration samples in milliseconds. */
export function stats(samples: number[]) {
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length
  const variance = samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / samples.length
  return {
    mean,
    stddev: Math.sqrt(variance),
    min: Math.min(...samples),
    max: Math.max(...samples),
  }
}

/** Compare base and head mean durations against a percentage threshold. */
export function compare(base: number, head: number, threshold: number) {
  const ratio = head / base
  if (ratio > 1 + threshold / 100) return { ratio, verdict: "regression" as const }
  if (ratio < 1 - threshold / 100) return { ratio, verdict: "improvement" as const }
  return { ratio, verdict: "neutral" as const }
}

/** Validate and normalize the numeric bench options. Returns an error message string for invalid input. */
export function normalize(options: { runs: number; warmup: number; threshold: number }) {
  if (!Number.isFinite(options.runs) || !Number.isFinite(options.warmup))
    return "--runs and --warmup must be finite numbers."
  if (!Number.isFinite(options.threshold) || options.threshold < 0)
    return "--threshold must be a finite, non-negative percentage."
  return {
    runs: Math.max(1, Math.floor(options.runs)),
    warmup: Math.max(0, Math.floor(options.warmup)),
    threshold: options.threshold,
  }
}

/** Render a stats line like "mean 124.3ms (stddev 3.1ms, min 120.9ms, max 129.0ms)". */
export function render(summary: ReturnType<typeof stats>) {
  const ms = (value: number) => `${value.toFixed(1)}ms`
  return `mean ${ms(summary.mean)} (stddev ${ms(summary.stddev)}, min ${ms(summary.min)}, max ${ms(summary.max)})`
}

export const BenchCommand = effectCmd({
  command: "bench <command>",
  describe: "benchmark a command on this change and on the base ref, and flag regressions",
  builder: (yargs) =>
    yargs
      .positional("command", {
        type: "string",
        demandOption: true,
        describe: 'command to time, e.g. "bun test ./test/hot.test.ts"',
      })
      .option("base", {
        alias: "b",
        type: "string",
        describe: "ref to compare against (defaults to the merge base with the default branch)",
      })
      .option("runs", {
        alias: "n",
        type: "number",
        default: 5,
        describe: "timed runs per side",
      })
      .option("warmup", {
        type: "number",
        default: 1,
        describe: "untimed warmup runs per side",
      })
      .option("threshold", {
        alias: "t",
        type: "number",
        default: 10,
        describe: "percentage slowdown that counts as a regression",
      }),
  handler: Effect.fn("Cli.bench")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const git = yield* Git.Service
    const cwd = ctx.worktree
    const command = args.command
    const options = normalize(args)
    if (typeof options === "string") return yield* fail(options)
    const runs = options.runs
    const warmup = options.warmup

    const base = yield* Effect.gen(function* () {
      if (args.base) return args.base
      const branch = yield* git.defaultBranch(cwd)
      if (!branch) return yield* fail("Could not determine the default branch. Pass a ref with --base.")
      const merge = yield* git.mergeBase(cwd, branch.ref)
      if (!merge) return yield* fail(`Could not find a merge base with ${branch.ref}. Pass a ref with --base.`)
      return merge
    })

    const measure = (dir: string, label: string) =>
      Effect.gen(function* () {
        const shell = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command]
        const execute = Effect.promise(async () => {
          const started = performance.now()
          const proc = Bun.spawn(shell, { cwd: dir, stdout: "ignore", stderr: "ignore" })
          const code = await proc.exited
          return { code, elapsed: performance.now() - started }
        })
        for (let index = 0; index < warmup; index++) {
          const run = yield* execute
          if (run.code !== 0) return yield* fail(`The command failed on ${label} (exit ${run.code}).`)
        }
        const samples: number[] = []
        for (let index = 0; index < runs; index++) {
          const run = yield* execute
          if (run.code !== 0) return yield* fail(`The command failed on ${label} (exit ${run.code}).`)
          samples.push(run.elapsed)
          UI.println(`  ${label} run ${index + 1}/${runs}: ${run.elapsed.toFixed(1)}ms`)
        }
        return samples
      })

    const worktree = path.join(os.tmpdir(), `bolt-bench-${process.pid}-${Date.now()}`)
    UI.println(`Checking out base ${base.slice(0, 12)} into a temporary worktree...`)
    const added = yield* git.run(["worktree", "add", "--detach", worktree, base], { cwd })
    if (added.exitCode !== 0) return yield* fail(added.stderr.toString().trim() || "git worktree add failed")

    const result = yield* Effect.gen(function* () {
      UI.println(`Timing "${command}" on base (${warmup} warmup, ${runs} timed)...`)
      const before = yield* measure(worktree, "base")
      UI.println(`Timing "${command}" on this change (${warmup} warmup, ${runs} timed)...`)
      const after = yield* measure(cwd, "head")
      return { before, after }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          const removed = yield* git.run(["worktree", "remove", "--force", worktree], { cwd }).pipe(Effect.exit)
          if (Exit.isSuccess(removed) && removed.value.exitCode === 0) return
          UI.error(
            `Failed to remove the temporary worktree. Run "git worktree remove --force ${worktree}" to clean up.`,
          )
        }),
      ),
    )

    const baseline = stats(result.before)
    const current = stats(result.after)
    const outcome = compare(baseline.mean, current.mean, args.threshold)

    UI.empty()
    UI.println(`Base: ${render(baseline)}`)
    UI.println(`Head: ${render(current)}`)
    UI.println(`Head/base ratio: ${outcome.ratio.toFixed(3)} (threshold ${args.threshold}%)`)
    if (outcome.verdict === "regression") {
      UI.println(`Verdict: REGRESSION. Head is ${((outcome.ratio - 1) * 100).toFixed(1)}% slower than base.`)
      process.exitCode = 1
      return
    }
    if (outcome.verdict === "improvement") {
      UI.println(`Verdict: improvement. Head is ${((1 - outcome.ratio) * 100).toFixed(1)}% faster than base.`)
      return
    }
    UI.println("Verdict: neutral. No change beyond the threshold.")
  }),
})
