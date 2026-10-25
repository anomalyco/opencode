import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

export type Parsed = {
  readonly type?: string
  readonly scope?: string
  readonly summary: string
}

export type Convention = {
  readonly conventional: boolean
  readonly types: string[]
  readonly scopes: string[]
  readonly length: number
  readonly period: boolean
  readonly lower: boolean
}

/** Parse a commit subject into conventional-commit parts. Freeform subjects parse as summary only. */
export function subject(line: string): Parsed {
  const match = line.match(/^([a-z]+)(?:\(([^)]*)\))?!?:\s+(.*)$/)
  if (!match) return { summary: line } satisfies Parsed
  return {
    type: match[1],
    ...(match[2] === undefined ? {} : { scope: match[2] }),
    summary: match[3],
  } satisfies Parsed
}

/** Infer the repo's commit subject conventions from a sample of history subjects. */
export function convention(history: string[]) {
  const parsed = history.map(subject)
  const typed = parsed.filter((entry) => entry.type !== undefined)
  const conventional = history.length > 0 && typed.length >= history.length / 2

  const count = (values: string[]) =>
    values.reduce<Record<string, number>>((acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1
      return acc
    }, {})
  const keep = (tally: Record<string, number>, floor: number) =>
    Object.keys(tally)
      .filter((key) => tally[key] >= floor)
      .sort()

  const types = keep(count(typed.map((entry) => entry.type ?? "")), Math.max(2, history.length * 0.02))
  const scoped = typed.map((entry) => entry.scope).filter((scope): scope is string => scope !== undefined)
  const scopes = keep(count(scoped), Math.max(2, history.length * 0.02))

  const lengths = history.map((line) => line.length).sort((a, b) => a - b)
  const p95 = lengths.length ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.95))] : 72
  const period = history.filter((line) => line.endsWith(".")).length > history.length * 0.2
  const summaries = parsed.map((entry) => entry.summary).filter(Boolean)
  const lower =
    summaries.length > 0 &&
    summaries.filter((line) => line[0] === line[0].toLowerCase()).length >= summaries.length * 0.8

  return {
    conventional,
    types,
    scopes,
    length: Math.max(50, p95),
    period,
    lower,
  } satisfies Convention
}

/** Lint one commit subject against the inferred convention. Returns violation strings. */
export function lint(line: string, rules: Convention) {
  const found: string[] = []
  const parsed = subject(line)
  if (rules.conventional && parsed.type === undefined) {
    found.push(`not in the repo's type(scope): summary style`)
  }
  if (rules.conventional && parsed.type !== undefined && rules.types.length && !rules.types.includes(parsed.type)) {
    found.push(`type "${parsed.type}" is not used in this repo (${rules.types.join(", ")})`)
  }
  if (rules.conventional && parsed.scope !== undefined && rules.scopes.length && !rules.scopes.includes(parsed.scope)) {
    found.push(`scope "${parsed.scope}" is not used in this repo (${rules.scopes.join(", ")})`)
  }
  if (line.length > rules.length) {
    found.push(`subject is ${line.length} characters; this repo stays under ${rules.length}`)
  }
  if (!rules.period && line.endsWith(".")) {
    found.push("subject ends with a period; this repo's subjects do not")
  }
  if (rules.lower && parsed.summary && parsed.summary[0] !== parsed.summary[0].toLowerCase()) {
    found.push("summary starts uppercase; this repo starts summaries lowercase")
  }
  return found
}

export const CommitlintCommand = effectCmd({
  command: "commitlint",
  describe: "lint commit messages against this repo's own conventions",
  builder: (yargs) =>
    yargs
      .option("range", {
        type: "string",
        describe: "commit range to lint (defaults to the merge base with the default branch to HEAD)",
      })
      .option("history", {
        type: "number",
        default: 200,
        describe: "how many commits of history to learn the conventions from",
      }),
  handler: Effect.fn("Cli.commitlint")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const git = yield* Git.Service
    const cwd = ctx.worktree

    const base = yield* git.defaultBranch(cwd)
    const range = yield* Effect.gen(function* () {
      if (args.range) return args.range
      if (!base) return yield* fail("Could not determine the default branch. Pass a range with --range.")
      const merge = yield* git.mergeBase(cwd, base.ref)
      if (!merge) return yield* fail(`Could not find a merge base with ${base.ref}.`)
      return `${merge}..HEAD`
    })

    const sampled = yield* git.run(
      ["log", "--no-merges", `--format=%s`, "-n", String(args.history), base ? base.ref : "HEAD"],
      { cwd },
    )
    if (sampled.exitCode !== 0) return yield* fail(sampled.stderr.toString().trim() || "git log failed")
    const history = sampled
      .text()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    if (history.length < 10) {
      return yield* fail("Not enough history to learn conventions from. Need at least 10 commits.")
    }
    const rules = convention(history)

    const listed = yield* git.run(["log", "--no-merges", "--format=%h%x00%s", range], { cwd })
    if (listed.exitCode !== 0) return yield* fail(listed.stderr.toString().trim() || "git log failed")
    const commits = listed
      .text()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("\x00"))
      .map((parts) => ({ sha: parts[0], subject: parts[1] ?? "" }))
    if (!commits.length) {
      UI.println(`No commits in ${range}. Nothing to lint.`)
      return
    }

    UI.println(
      `Learned from ${history.length} commits: ${rules.conventional ? `type(scope): summary style, types [${rules.types.join(", ")}]` : "freeform subjects"}, max ${rules.length} chars.`,
    )
    UI.empty()

    const dirty = commits
      .map((commit) => ({ commit, issues: lint(commit.subject, rules) }))
      .filter((entry) => entry.issues.length)
    for (const entry of dirty) {
      UI.println(`${entry.commit.sha} ${entry.commit.subject}`)
      for (const issue of entry.issues) UI.println(`  - ${issue}`)
    }

    if (!dirty.length) {
      UI.println(`All ${commits.length} commit messages match the repo's conventions.`)
      return
    }
    UI.empty()
    UI.println(`${dirty.length} of ${commits.length} commit messages break the repo's conventions.`)
    process.exitCode = 1
  }),
})
