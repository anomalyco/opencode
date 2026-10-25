import path from "node:path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

export type Mutant = {
  line: number
  description: string
  source: string
}

type Operator = {
  pattern: RegExp
  replacement: string
}

// One entry per mutation operator. Patterns are line-scoped and deliberately
// conservative: bare `<` and `>` are skipped (generics, JSX), compound
// assignments like `&&=` are excluded, and arithmetic only matches spaced
// binary operators so `++`, `--`, and unary signs are left alone.
const operators: Operator[] = [
  // `[=]` avoids a regex literal starting with `/=`, which reads like `/=`.
  { pattern: /[=]==/g, replacement: "!==" },
  { pattern: /!==/g, replacement: "===" },
  { pattern: /(?<![&=!])&&(?![&=])/g, replacement: "||" },
  { pattern: /(?<![|=])\|\|(?![|=])/g, replacement: "&&" },
  { pattern: /(?<!<)<=/g, replacement: "<" },
  { pattern: /(?<!>)>=(?!=)/g, replacement: ">" },
  { pattern: / \+ /g, replacement: " - " },
  { pattern: / - /g, replacement: " + " },
  { pattern: /\btrue\b/g, replacement: "false" },
  { pattern: /\bfalse\b/g, replacement: "true" },
]

/** Generate single-site mutants of a source file, one per mutable occurrence. */
export function mutate(source: string) {
  const lines = source.split("\n")
  return lines.flatMap((text, index) => {
    const trimmed = text.trimStart()
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return []
    return operators.flatMap((operator) =>
      [...text.matchAll(operator.pattern)].map(
        (match): Mutant => ({
          line: index + 1,
          description: `${match[0].trim()} -> ${operator.replacement.trim()}`,
          source: [
            ...lines.slice(0, index),
            text.slice(0, match.index) + operator.replacement + text.slice(match.index + match[0].length),
            ...lines.slice(index + 1),
          ].join("\n"),
        }),
      ),
    )
  })
}

export const MutateCommand = effectCmd({
  command: "mutate <file>",
  describe: "mutate a file and rerun the tests to prove they catch bugs",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        demandOption: true,
        describe: "source file to mutate",
      })
      .option("command", {
        alias: "c",
        type: "string",
        describe: "test command to run per mutant (detected from the project when omitted)",
      })
      .option("limit", {
        alias: "n",
        type: "number",
        default: 25,
        describe: "maximum number of mutants to test",
      })
      .option("timeout", {
        type: "number",
        default: 120_000,
        describe: "per-run timeout in milliseconds",
      }),
  handler: Effect.fn("Cli.mutate")(function* (args) {
    if (!Number.isInteger(args.limit) || args.limit < 1) return yield* fail("--limit must be a positive integer")
    if (!Number.isFinite(args.timeout) || args.timeout <= 0)
      return yield* fail("--timeout must be a positive number of milliseconds")
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { FSUtil } = yield* Effect.promise(() => import("@bolt-ai/core/fs-util"))
    const { detect } = yield* Effect.promise(() => import("@/tool/testrun"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const cwd = ctx.worktree
    const target = path.resolve(cwd, args.file)
    const exists = yield* Effect.promise(() => Bun.file(target).exists())
    if (!exists) return yield* fail(`No such file: ${args.file}`)

    const fs = yield* FSUtil.Service
    const command = args.command ?? (yield* detect(fs, cwd))
    if (!command) return yield* fail("Could not detect a test command for this project. Pass one with --command.")

    const original = yield* Effect.promise(() => Bun.file(target).text())
    const found = mutate(original)
    if (found.length === 0) {
      UI.println("No mutable sites found in this file.")
      return
    }
    const mutants = found.slice(0, args.limit)

    const shell = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command]
    const execute = () =>
      Effect.promise(async () => {
        // Own process group on POSIX so a timed-out run cannot leak test
        // children into later mutant runs.
        const proc = Bun.spawn(shell, {
          cwd,
          stdout: "ignore",
          stderr: "ignore",
          detached: process.platform !== "win32",
        })
        // A mutant can loop forever; kill the whole process tree and count the
        // run as killed.
        const timer = setTimeout(() => {
          if (process.platform === "win32") {
            Bun.spawn(["taskkill", "/pid", String(proc.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
            return
          }
          try {
            process.kill(-proc.pid, "SIGKILL")
          } catch {
            proc.kill()
          }
        }, args.timeout)
        const code = await proc.exited
        clearTimeout(timer)
        return code
      })

    UI.println(`Baseline: running "${command}"...`)
    const baseline = yield* execute()
    if (baseline !== 0) return yield* fail("The test command fails before any mutation. Fix the suite first.")

    UI.println(`Testing ${mutants.length} of ${found.length} mutants...`)
    const survivors: Mutant[] = []
    yield* Effect.gen(function* () {
      for (const [index, mutant] of mutants.entries()) {
        yield* Effect.promise(() => Bun.write(target, mutant.source))
        const code = yield* execute()
        const label = `mutant ${index + 1}/${mutants.length} line ${mutant.line} ${mutant.description}`
        if (code === 0) survivors.push(mutant)
        UI.println(`  ${label}: ${code === 0 ? "SURVIVED" : "killed"}`)
      }
    }).pipe(Effect.ensuring(Effect.promise(() => Bun.write(target, original))))

    const killed = mutants.length - survivors.length
    UI.empty()
    UI.println(`Mutation score: ${killed}/${mutants.length} killed (${Math.round((killed / mutants.length) * 100)}%).`)
    if (survivors.length === 0) {
      UI.println("Every mutant was caught. The tests guard this file well.")
      return
    }
    UI.println("Surviving mutants mean the tests never noticed the change:")
    for (const mutant of survivors) {
      UI.println(`  ${args.file}:${mutant.line} ${mutant.description}`)
    }
    process.exitCode = 1
  }),
})
