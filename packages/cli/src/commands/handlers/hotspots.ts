import path from "node:path"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"

const SKIP = new Set([".git", "node_modules", "dist", "build", ".turbo"])
const MATCH = /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py|rb|java|kt|c|h|cc|cpp|hpp|cs|php|swift)$/
const BRANCH = /\b(if|for|while|case|catch)\b|&&|\|\||\?\?|\?[^.:]/g
const SINCE = "90 days"
const LIMIT = 20
const INDENT = 2

export type Churn = { commits: number; changes: number }
export type Spot = { file: string; commits: number; changes: number; complexity: number; score: number }

/** Rename notation in git numstat paths, e.g. `src/{old => new}/x.ts` or `old.ts => new.ts`, resolved to the new path. */
export function rename(file: string) {
  return file
    .replace(/\{([^{}]*) => ([^{}]*)\}/g, "$2")
    .replace(/^([^{}]*) => ([^{}]*)$/, "$2")
    .replaceAll("//", "/")
}

/** Per-file churn from `git log --numstat` output: how many commits touched the file, and total lines added plus deleted. */
export function churn(log: string) {
  const result = new Map<string, Churn>()
  for (const line of log.split("\n")) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!match) continue
    const file = rename(match[3].replaceAll("\\", "/"))
    const previous = result.get(file) ?? { commits: 0, changes: 0 }
    const added = match[1] === "-" ? 0 : Number(match[1])
    const removed = match[2] === "-" ? 0 : Number(match[2])
    result.set(file, { commits: previous.commits + 1, changes: previous.changes + added + removed })
  }
  return result
}

/**
 * Cheap complexity proxy: one point per branching construct plus the maximum
 * indentation depth. Good enough to separate flat data files from tangled
 * control flow without a parser.
 */
export function complexity(text: string) {
  let depth = 0
  let branches = 0
  for (const line of text.split("\n")) {
    const code = line.replace(/\s+$/, "")
    if (code === "") continue
    const indent = (code.match(/^[\t ]*/)?.[0] ?? "").replace(/\t/g, "  ").length
    depth = Math.max(depth, Math.floor(indent / INDENT))
    branches += (code.match(BRANCH) ?? []).length
  }
  return branches + depth
}

/**
 * Joins churn with complexity and ranks by their product, the classic hotspot
 * score: files that change all the time and are hard to change score highest.
 * Files with a single touch or trivial complexity are noise and dropped.
 */
export function hotspots(touched: Map<string, Churn>, files: Record<string, string>) {
  return Object.keys(files)
    .flatMap((file) => {
      const entry = touched.get(file)
      if (!entry || entry.commits < 2) return []
      const cost = complexity(files[file])
      if (cost < 5) return []
      return [{ file, commits: entry.commits, changes: entry.changes, complexity: cost, score: entry.commits * cost }]
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
}

/** Renders ranked hotspots as a markdown table. */
export function markdown(spots: Spot[], since: string, limit = LIMIT) {
  if (spots.length === 0)
    return `# Hotspots\n\nNo files with both high churn and high complexity in the last ${since}.\n`
  const rows = spots
    .slice(0, limit)
    .map((spot) => `| \`${spot.file}\` | ${spot.commits} | ${spot.changes} | ${spot.complexity} | ${spot.score} |`)
  return [
    "# Hotspots",
    "",
    `Files with high churn and high complexity in the last ${since}; refactor candidates first.`,
    "",
    "| File | Commits | Lines changed | Complexity | Score |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}

export const HotspotsCommand = effectCmd({
  command: "hotspots",
  describe: "flag files with high churn and high complexity for refactoring",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("since", { describe: "history window, any git-parseable date", type: "string", default: SINCE })
      .option("limit", { describe: "maximum files to report", type: "number", default: LIMIT }),
  handler: Effect.fn("Cli.hotspots")(function* (args) {
    const cwd = process.cwd()
    const proc = Bun.spawn(["git", "log", `--since=${args.since}`, "--numstat", "--format=%H", "--relative"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const log = yield* Effect.promise(() => new Response(proc.stdout).text())
    const code = yield* Effect.promise(() => proc.exited)
    if (code !== 0) return yield* fail("git log failed; run inside a git worktree")
    const touched = churn(log)
    const files: Record<string, string> = {}
    for (const file of touched.keys()) {
      if (!MATCH.test(file) || file.split("/").some((part) => SKIP.has(part))) continue
      const handle = Bun.file(path.join(cwd, file))
      const exists = yield* Effect.promise(() => handle.exists())
      if (exists) files[file] = yield* Effect.promise(() => handle.text())
    }
    const spots = hotspots(touched, files)
    process.stdout.write(markdown(spots, args.since, Math.max(1, Math.floor(args.limit))))
    process.stderr.write(`Analyzed ${Object.keys(files).length} changed files, flagged ${spots.length} hotspots\n`)
  }),
})
