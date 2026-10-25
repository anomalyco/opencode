import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const SYMBOL_LIMIT = 50
const MENTION_LIMIT = 10

// Declaration shapes whose deletion suggests a symbol was removed or renamed.
const declarations = [
  /^export (?:async )?function\*? (\w+)/,
  /^export (?:const|let|var) (\w+)/,
  /^export (?:abstract )?class (\w+)/,
  /^export (?:type|interface|enum) (\w+)/,
  /^(?:async )?function\*? (\w+)/,
  /^class (\w+)/,
  /^def (\w+)\(/,
]

/** Extract symbols whose declarations were deleted by a unified diff. */
export function removed(diff: string) {
  const result: { file: string; name: string }[] = []
  let file = ""
  for (const line of diff.split("\n")) {
    const header = line.match(/^--- a\/(.+)$/)
    if (header) {
      file = header[1]
      continue
    }
    if (!line.startsWith("-") || line.startsWith("---")) continue
    const text = line.slice(1).trim()
    for (const declaration of declarations) {
      const match = text.match(declaration)
      if (!match) continue
      if (result.some((entry) => entry.name === match[1])) continue
      result.push({ file, name: match[1] })
    }
  }
  return result
}

/** True for documentation files where mentions of removed code go stale. */
export function docfile(file: string) {
  return /\.(?:md|mdx|markdown|rst|adoc)$/i.test(file)
}

/** True when a source line is a comment. */
export function comment(text: string) {
  const trimmed = text.trimStart()
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("<!--")
  )
}

export type Ref = {
  path: string
  line: number
  text: string
}

/** Split references to a symbol into live code usage and doc/comment mentions. */
export function classify(refs: Ref[]) {
  const alive = refs.some((ref) => !docfile(ref.path) && !comment(ref.text))
  const mentions = refs.filter((ref) => docfile(ref.path) || comment(ref.text))
  return { alive, mentions }
}

export const DriftCommand = effectCmd({
  command: "drift",
  describe: "flag READMEs and comments that the current diff just made stale",
  builder: (yargs) =>
    yargs
      .option("staged", {
        type: "boolean",
        describe: "inspect staged changes only",
        default: false,
      })
      .option("branch", {
        type: "string",
        describe: "inspect changes since the merge base with a branch (defaults to the default branch)",
      })
      .conflicts("staged", "branch"),
  handler: Effect.fn("Cli.drift")(function* (args) {
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
      const base = args.branch || (yield* git.defaultBranch(cwd).pipe(Effect.map((branch) => branch?.ref)))
      if (!base) return yield* fail("Could not determine the default branch. Pass one with --branch <name>.")
      const merge = yield* git.mergeBase(cwd, base)
      if (!merge) return yield* fail(`Could not find a merge base with ${base}.`)
      return ["diff", `${merge}..HEAD`]
    })

    const diff = yield* git.run(range, { cwd })
    if (diff.exitCode !== 0) return yield* fail(diff.stderr.toString().trim() || "git diff failed")
    const symbols = removed(diff.text()).slice(0, SYMBOL_LIMIT)
    if (symbols.length === 0) {
      UI.println("The diff removed no declarations. Nothing to check.")
      return
    }

    UI.println(`Checking ${symbols.length} removed declaration${symbols.length === 1 ? "" : "s"} against docs...`)
    const rg = yield* Ripgrep.Service
    const findings: { file: string; name: string; mentions: Ref[] }[] = []
    for (const symbol of symbols) {
      const matches = yield* rg
        .grep({ cwd, pattern: `\\b${symbol.name}\\b`, limit: 200 })
        .pipe(Effect.catch(() => Effect.succeed([])))
      const refs = matches.map((match) => ({ path: match.entry.path, line: match.line, text: match.text }))
      const outcome = classify(refs)
      // Still referenced by live code: the symbol moved or survived, docs are fine.
      if (outcome.alive) continue
      if (outcome.mentions.length === 0) continue
      findings.push({ file: symbol.file, name: symbol.name, mentions: outcome.mentions })
    }

    UI.empty()
    if (findings.length === 0) {
      UI.println("No stale docs found. Every removed symbol is gone from docs and comments too.")
      return
    }

    UI.println(
      `Found ${findings.length} removed symbol${findings.length === 1 ? "" : "s"} still mentioned in docs or comments:`,
    )
    for (const finding of findings) {
      UI.println(`  ${finding.name} (removed from ${finding.file}):`)
      for (const mention of finding.mentions.slice(0, MENTION_LIMIT)) {
        UI.println(`    ${mention.path}:${mention.line} ${mention.text.trim().slice(0, 120)}`)
      }
      if (finding.mentions.length > MENTION_LIMIT) {
        UI.println(`    ...and ${finding.mentions.length - MENTION_LIMIT} more`)
      }
    }
    UI.empty()
    UI.println("Update or delete these references before handing off the diff.")
    process.exitCode = 1
  }),
})
