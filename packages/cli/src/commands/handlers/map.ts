import path from "node:path"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"

const SKIP = new Set([".git", "node_modules", "dist", "build", ".turbo"])
const EXTENSIONS = ["ts", "tsx", "js", "jsx"]
const PATTERN = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g

/** First `depth` path segments of a file's directory, or "." for worktree-root files. */
export function bucket(file: string, depth: number) {
  const dir = path.posix.dirname(file)
  if (dir === ".") return "."
  return dir.split("/").slice(0, depth).join("/")
}

/** Relative import specifiers in `text`, resolved against `known` file paths. */
export function imports(file: string, text: string, known: Set<string>) {
  const dir = path.posix.dirname(file)
  return [...text.matchAll(PATTERN)].flatMap((match) => {
    const base = path.posix.normalize(path.posix.join(dir, match[1].replace(/\.(ts|tsx|js|jsx)$/, "")))
    const found = EXTENSIONS.flatMap((ext) => [`${base}.${ext}`, `${base}/index.${ext}`]).find((name) =>
      known.has(name),
    )
    return found ? [found] : []
  })
}

/**
 * Aggregates a file -> imported-files record into directory-level dependencies.
 * Deterministic: edges are deduped, self-loops dropped, sorted, and capped at 60.
 */
export function graph(files: Record<string, string[]>, depth: number) {
  const names = Object.keys(files).sort()
  const counts: Record<string, number> = {}
  for (const name of names) {
    const dir = bucket(name, depth)
    counts[dir] = (counts[dir] ?? 0) + 1
  }
  const pairs = names.flatMap((name) =>
    files[name]
      .map((target) => ({ from: bucket(name, depth), to: bucket(target, depth) }))
      .filter((edge) => edge.from !== edge.to),
  )
  const unique = new Map(pairs.map((edge) => [`${edge.from}\u0000${edge.to}`, edge]))
  const edges = [...unique.values()]
    .sort((a, b) => `${a.from}\u0000${a.to}`.localeCompare(`${b.from}\u0000${b.to}`))
    .slice(0, 60)
  return { edges, counts }
}

/** Renders the graph as markdown: a mermaid `graph TD` plus a per-directory file count table. */
export function markdown(result: ReturnType<typeof graph>) {
  const dirs = Object.keys(result.counts).sort()
  const ids = new Map(dirs.map((dir, index) => [dir, `d${index}`]))
  const nodes = dirs.map((dir) => `  ${ids.get(dir)}["${dir}"]`)
  const arrows = result.edges.map((edge) => `  ${ids.get(edge.from) ?? edge.from} --> ${ids.get(edge.to) ?? edge.to}`)
  const rows = dirs.map((dir) => `| \`${dir}\` | ${result.counts[dir]} |`)
  return [
    "# Codebase map",
    "",
    "## Directory dependencies",
    "",
    "```mermaid",
    "graph TD",
    ...nodes,
    ...arrows,
    "```",
    "",
    "## Files per directory",
    "",
    "| Directory | Files |",
    "| --- | --- |",
    ...rows,
    "",
  ].join("\n")
}

export const MapCommand = effectCmd({
  command: "map",
  describe: "draw a markdown + mermaid map of source directory dependencies",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("out", {
        describe: "output markdown file",
        type: "string",
        default: "codebase-map.md",
      })
      .option("depth", {
        describe: "directory depth to aggregate to",
        type: "number",
        default: 2,
      }),
  handler: Effect.fn("Cli.map")(function* (args) {
    const cwd = process.cwd()
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}")
    const scanned = yield* Effect.promise(() => Array.fromAsync(glob.scan({ cwd })))
    const names = scanned
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => !name.split("/").some((part) => SKIP.has(part)))
      .sort()
    const known = new Set(names)
    const files: Record<string, string[]> = {}
    for (const name of names) {
      const text = yield* Effect.promise(() => Bun.file(path.join(cwd, name)).text())
      files[name] = imports(name, text, known)
    }
    const depth = Math.max(1, Math.floor(args.depth))
    yield* Effect.promise(() => Bun.write(path.join(cwd, args.out), markdown(graph(files, depth))))
    process.stderr.write(`Wrote codebase map for ${names.length} files to ${args.out}\n`)
  }),
})
