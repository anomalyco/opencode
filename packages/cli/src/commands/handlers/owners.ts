import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { bucket } from "./map"

const SINCE = "1 year"
const DEPTH = 2
const TOP = 3
const MARKER = "\u0001"
const PLACES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]

export type Rule = { pattern: string; owners: string[] }
export type Row = { dir: string; commits: number; top: { author: string; share: number }[]; declared: string[] }

/** CODEOWNERS rules in file order, comments and blanks dropped. Later rules win, per GitHub semantics. */
export function codeowners(text: string) {
  return text.split("\n").flatMap((line) => {
    const body = line.replace(/(^|\s)#.*$/, "").trim()
    if (body === "") return []
    const parts = body.split(/\s+/)
    if (parts.length < 2) return []
    return [{ pattern: parts[0], owners: parts.slice(1) }]
  })
}

/** Regex for a CODEOWNERS pattern: `**` spans directories, `*` stays within one, leading `/` anchors, trailing `/` matches the subtree. */
export function matcher(pattern: string) {
  const anchored = pattern.startsWith("/")
  const trimmed = pattern.replace(/^\//, "")
  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0002")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0002/g, ".*")
    .replace(/\?/g, "[^/]")
  const prefix = anchored ? "^" : "(^|/)"
  const suffix = pattern.endsWith("/") ? "" : "(/|$)"
  return new RegExp(`${prefix}${escaped}${suffix}`)
}

/** Owners of the last rule matching `file`, or none. */
export function owner(rules: Rule[], file: string) {
  const hit = rules.findLast((rule) => matcher(rule.pattern).test(file))
  return hit ? hit.owners : []
}

/** Per-file commit counts by author from `git log --format=<marker>%an --numstat` output. */
export function authors(log: string) {
  const result = new Map<string, Map<string, number>>()
  let current = ""
  for (const line of log.split("\n")) {
    if (line.startsWith(MARKER)) {
      current = line.slice(1).trim()
      continue
    }
    const match = line.match(/^(?:\d+|-)\t(?:\d+|-)\t(.+)$/)
    if (!match || current === "") continue
    const file = match[1]
      .replace(/\{([^{}]*) => ([^{}]*)\}/g, "$2")
      .replaceAll("//", "/")
      .replaceAll("\\", "/")
    const counts = result.get(file) ?? new Map<string, number>()
    counts.set(current, (counts.get(current) ?? 0) + 1)
    result.set(file, counts)
  }
  return result
}

/**
 * Aggregates per-file authorship into directory buckets: total commits, top
 * contributors with their share of the directory's commits, and the declared
 * CODEOWNERS entry that covers the most files in the bucket.
 */
export function table(history: Map<string, Map<string, number>>, rules: Rule[], depth = DEPTH) {
  const dirs = new Map<string, { commits: Map<string, number>; declared: Map<string, number> }>()
  for (const [file, counts] of history) {
    const dir = bucket(file, depth)
    const entry = dirs.get(dir) ?? { commits: new Map(), declared: new Map() }
    for (const [author, commits] of counts) {
      entry.commits.set(author, (entry.commits.get(author) ?? 0) + commits)
    }
    const declared = owner(rules, file).join(" ")
    if (declared !== "") entry.declared.set(declared, (entry.declared.get(declared) ?? 0) + 1)
    dirs.set(dir, entry)
  }
  return [...dirs.entries()]
    .map(([dir, entry]) => {
      const total = [...entry.commits.values()].reduce((sum, value) => sum + value, 0)
      const top = [...entry.commits.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP)
        .map(([author, commits]) => ({ author, share: Math.round((commits / total) * 100) }))
      const declared = [...entry.declared.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      return { dir, commits: total, top, declared: declared.length > 0 ? declared[0][0].split(" ") : [] }
    })
    .sort((a, b) => b.commits - a.commits || a.dir.localeCompare(b.dir))
}

/** Renders the ownership table as markdown, flagging directories without declared owners. */
export function markdown(rows: Row[], since: string) {
  if (rows.length === 0) return `# Ownership map\n\nNo commits in the last ${since}.\n`
  const undeclared = rows.filter((row) => row.declared.length === 0).length
  const lines = rows.map((row) => {
    const top = row.top.map((entry) => `${entry.author} (${entry.share}%)`).join(", ")
    const declared = row.declared.length > 0 ? row.declared.map((name) => `\`${name}\``).join(" ") : "none"
    return `| \`${row.dir}\` | ${row.commits} | ${top} | ${declared} |`
  })
  return [
    "# Ownership map",
    "",
    `Inferred from ${since} of history plus CODEOWNERS. ${undeclared} of ${rows.length} directories have no declared owner.`,
    "",
    "| Directory | Commits | Top contributors | CODEOWNERS |",
    "| --- | --- | --- | --- |",
    ...lines,
    "",
  ].join("\n")
}

export const OwnersCommand = effectCmd({
  command: "owners",
  describe: "map directory ownership from git history and CODEOWNERS",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("since", { describe: "history window, any git-parseable date", type: "string", default: SINCE })
      .option("depth", { describe: "directory depth to aggregate to", type: "number", default: DEPTH }),
  handler: Effect.fn("Cli.owners")(function* (args) {
    const cwd = process.cwd()
    const proc = Bun.spawn(
      ["git", "log", `--since=${args.since}`, `--format=${MARKER}%an`, "--numstat", "--relative", "--no-merges"],
      { cwd, stdout: "pipe", stderr: "pipe" },
    )
    const log = yield* Effect.promise(() => new Response(proc.stdout).text())
    const code = yield* Effect.promise(() => proc.exited)
    if (code !== 0) return yield* fail("git log failed; run inside a git worktree")
    const rules: Rule[] = []
    for (const place of PLACES) {
      const handle = Bun.file(`${cwd}/${place}`)
      const exists = yield* Effect.promise(() => handle.exists())
      if (!exists) continue
      rules.push(...codeowners(yield* Effect.promise(() => handle.text())))
      break
    }
    const rows = table(authors(log), rules, Math.max(1, Math.floor(args.depth)))
    process.stdout.write(markdown(rows, args.since))
    process.stderr.write(`Mapped ${rows.length} directories from ${rules.length} CODEOWNERS rules and git history\n`)
  }),
})
