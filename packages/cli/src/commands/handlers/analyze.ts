import path from "node:path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const OUTPUT_LIMIT = 8_000
const SYMBOL_LIMIT = 50
const CODE = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]

/** Extract the changed file paths from a unified diff. */
export function changed(diff: string) {
  return [
    ...new Set(
      diff
        .split("\n")
        .flatMap((line) => {
          const match = line.match(/^\+\+\+ b\/(.+)$/)
          if (!match) return []
          return [match[1]]
        })
        .filter((file) => file !== "/dev/null"),
    ),
  ]
}

/** Extract exported symbol names and their lines from a source file. */
export function exported(source: string) {
  const declarations = [
    /^export (?:async )?function\*? (\w+)/,
    /^export (?:const|let|var) (\w+)/,
    /^export (?:abstract )?class (\w+)/,
    /^export (?:type|interface|enum) (\w+)/,
    /^export \* as (\w+)/,
  ]
  return source.split("\n").flatMap((text, index) => {
    const line = text.trim()
    const single = declarations.flatMap((declaration) => {
      const match = line.match(declaration)
      if (!match) return []
      return [{ name: match[1], line: index + 1 }]
    })
    if (single.length > 0) return single
    const list = line.match(/^export \{ ([^}]+) \}/)
    if (!list) return []
    return list[1]
      .split(",")
      .map(
        (entry) =>
          entry
            .trim()
            .split(/\s+as\s+/)
            .at(-1) ?? "",
      )
      .filter((name) => /^\w+$/.test(name) && name !== "default")
      .map((name) => ({ name, line: index + 1 }))
  })
}

/** True when every reference to a symbol lives in its defining file. */
export function dead(file: string, paths: string[]) {
  const source = file.replaceAll("\\", "/")
  return paths.every((reference) => reference.replaceAll("\\", "/") === source)
}

export const AnalyzeCommand = effectCmd({
  command: "analyze",
  describe: "run lint, typecheck, and dead-code checks over the current diff before handoff",
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
  handler: Effect.fn("Cli.analyze")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const { Ripgrep } = yield* Effect.promise(() => import("@bolt-ai/core/ripgrep"))
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

    const diff = yield* git.run(range, { cwd })
    if (diff.exitCode !== 0) return yield* fail(diff.stderr.toString().trim() || "git diff failed")
    const files = changed(diff.text())
    if (files.length === 0) {
      UI.println("Nothing to analyze.")
      return
    }
    UI.println(`Analyzing ${files.length} changed file${files.length === 1 ? "" : "s"}...`)

    // Lint and typecheck run through the project's own scripts so the pass
    // reflects exactly what the repo enforces.
    const manifest = path.join(cwd, "package.json")
    const pkg = yield* Effect.tryPromise(() => Bun.file(manifest).json()).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    const runner = yield* Effect.promise(async () => {
      if (await Bun.file(path.join(cwd, "bun.lock")).exists()) return "bun run"
      if (await Bun.file(path.join(cwd, "bun.lockb")).exists()) return "bun run"
      if (await Bun.file(path.join(cwd, "pnpm-lock.yaml")).exists()) return "pnpm run"
      if (await Bun.file(path.join(cwd, "yarn.lock")).exists()) return "yarn"
      return "npm run"
    })

    let failed = false
    for (const script of ["lint", "typecheck"]) {
      if (!pkg?.scripts?.[script]) {
        UI.println(`  ${script}: no "${script}" script in package.json, skipped`)
        continue
      }
      const command = `${runner} ${script}`
      const run = yield* Effect.promise(async () => {
        const proc = Bun.spawn(process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        })
        const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
        const code = await proc.exited
        return { code, output: [out.trim(), err.trim()].filter(Boolean).join("\n") }
      })
      if (run.code === 0) {
        UI.println(`  ${script}: pass`)
        continue
      }
      failed = true
      UI.println(`  ${script}: FAIL (exit ${run.code})`)
      UI.println(run.output.slice(-OUTPUT_LIMIT))
    }

    const rg = yield* Ripgrep.Service
    const sources = files.filter((file) => CODE.includes(path.extname(file)))
    const suspects: { file: string; name: string; line: number }[] = []
    let scanned = 0
    for (const file of sources) {
      const target = path.resolve(cwd, file)
      const exists = yield* Effect.promise(() => Bun.file(target).exists())
      if (!exists) continue
      const source = yield* Effect.promise(() => Bun.file(target).text())
      for (const symbol of exported(source)) {
        if (scanned >= SYMBOL_LIMIT) break
        scanned++
        const matches = yield* rg
          .grep({ cwd, pattern: `\\b${symbol.name}\\b`, include: `*{${CODE.join(",")}}`, limit: 200 })
          .pipe(Effect.catch(() => Effect.succeed([])))
        if (
          dead(
            file,
            matches.map((match) => match.entry.path),
          )
        ) {
          suspects.push({ file, name: symbol.name, line: symbol.line })
        }
      }
    }

    UI.empty()
    if (suspects.length > 0) {
      UI.println("Possibly dead exports (referenced nowhere outside their own file):")
      for (const suspect of suspects) UI.println(`  ${suspect.file}:${suspect.line} ${suspect.name}`)
      UI.empty()
    }
    if (scanned >= SYMBOL_LIMIT) UI.println(`Dead-code scan capped at ${SYMBOL_LIMIT} symbols.`)

    if (failed) {
      UI.println("Verdict: FAIL. Fix lint or typecheck before handing off this diff.")
      process.exitCode = 1
      return
    }
    UI.println(
      suspects.length > 0
        ? "Verdict: pass with warnings. Review the possibly dead exports before handoff."
        : "Verdict: pass. The diff is clean.",
    )
  }),
})
