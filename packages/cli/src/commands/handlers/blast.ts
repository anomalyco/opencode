import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

export const BlastCommand = effectCmd({
  command: "blast",
  describe: "estimate the blast radius of pending changes",
  builder: (yargs) =>
    yargs
      .option("staged", {
        type: "boolean",
        describe: "analyze staged changes only",
        default: false,
      })
      .option("branch", {
        type: "string",
        describe: "analyze changes since the merge base with a branch (defaults to the default branch)",
      })
      .conflicts("staged", "branch"),
  handler: Effect.fn("Cli.blast")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const { Blast } = yield* Effect.promise(() => import("@/blast"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }

    const git = yield* Git.Service
    const cwd = ctx.worktree

    const range = yield* Effect.gen(function* () {
      if (args.staged) return ["diff", "--cached"]
      if (args.branch === undefined) return ["diff", "HEAD"]
      const base = yield* Effect.gen(function* () {
        if (args.branch) return args.branch
        const branch = yield* git.defaultBranch(cwd)
        if (!branch) return yield* fail("Could not determine the default branch. Pass one with --branch <name>.")
        return branch.ref
      })
      const merge = yield* git.mergeBase(cwd, base)
      if (!merge) return yield* fail(`Could not find a merge base with ${base}.`)
      return ["diff", `${merge}..HEAD`]
    })

    const numstat = yield* git.run([...range, "--numstat"], { cwd })
    if (numstat.exitCode !== 0) return yield* fail(numstat.stderr.toString().trim() || "git diff failed")
    const changes = Blast.parse(numstat.text())
    if (changes.length === 0) {
      UI.println("No changes to analyze.")
      return
    }

    const additions = changes.reduce((sum, item) => sum + item.additions, 0)
    const deletions = changes.reduce((sum, item) => sum + item.deletions, 0)
    const packages = [...new Set(changes.map((item) => Blast.pkg(item.path)))].sort()
    const counts = { source: 0, test: 0, docs: 0, config: 0 }
    for (const change of changes) counts[Blast.kind(change.path)] += 1

    // Estimate dependents per changed source file by grepping for import specifiers
    // ending in the file's stem, e.g. `/undo"` matches `from "@/cli/cmd/undo"`.
    const sources = changes.filter((item) => Blast.kind(item.path) === "source").slice(0, 25)
    const dependents = yield* Effect.forEach(
      sources,
      (change) =>
        Effect.gen(function* () {
          const result = yield* git.run(["grep", "-l", "-F", `/${Blast.stem(change.path)}"`, "--", "*.ts", "*.tsx"], {
            cwd,
          })
          if (result.exitCode !== 0) return { path: change.path, count: 0 }
          const files = result
            .text()
            .split("\n")
            .filter((line) => line.length > 0 && line !== change.path)
          return { path: change.path, count: files.length }
        }),
      { concurrency: 4 },
    )

    const grade = Blast.risk({
      source: counts.source,
      tests: counts.test,
      packages: packages.length,
      dependents: Math.max(0, ...dependents.map((item) => item.count)),
    })

    UI.empty()
    UI.println(`Blast radius (${args.staged ? "staged" : args.branch !== undefined ? "branch" : "working tree"}):`)
    UI.empty()
    UI.println(
      `  ${changes.length} file${changes.length === 1 ? "" : "s"} changed (+${additions}/-${deletions}) across ${packages.length} package${packages.length === 1 ? "" : "s"}: ${packages.join(", ")}`,
    )
    UI.println(`  source: ${counts.source}, test: ${counts.test}, docs: ${counts.docs}, config: ${counts.config}`)
    const top = dependents
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    if (top.length > 0) {
      UI.empty()
      UI.println("  most-referenced changed files:")
      for (const item of top) {
        UI.println(`    ${item.path} — referenced by ~${item.count} file${item.count === 1 ? "" : "s"}`)
      }
    }
    UI.empty()
    UI.println(`  risk: ${grade}`)
    UI.empty()
  }),
})
