import path from "node:path"
import { Effect } from "effect"
import { FSUtil } from "@bolt-ai/core/fs-util"
import { effectCmd, fail } from "../effect-cmd"

const SKIP = new Set([".git", "node_modules", "dist", "build", ".turbo"])
const WINDOW = 6
const LIMIT = 20

export type Row = { line: number; text: string }
export type Site = { file: string; start: number; end: number }
export type Cluster = { sites: Site[]; lines: number }

/**
 * Normalizes source into comparable rows: comments stripped, whitespace
 * collapsed, string and numeric literals replaced with placeholders so
 * near-identical code (same shape, different literals) hashes equally.
 * Blank rows are dropped; each row keeps its original 1-based line number.
 */
export function normalize(text: string) {
  const rows: Row[] = []
  let mode: Mode = "code"
  text.split("\n").forEach((raw, index) => {
    const scanned = scan(raw, mode)
    mode = scanned.mode
    const body = scanned.body
      .replace(/\b\d[\w.]*/g, "N")
      .replace(/\s+/g, " ")
      .trim()
    if (body === "" || body === "}" || body === "};" || body === "{") return
    rows.push({ line: index + 1, text: body })
  })
  return rows
}

type Mode = "code" | "block" | "template"

/**
 * Scans one line with state carried across lines, recognizing string and
 * template literals before comment syntax so `//` or `/*` inside a literal
 * (e.g. a URL) is not treated as a comment. Literals collapse to `S`;
 * comments are dropped.
 */
function scan(line: string, mode: Mode) {
  let out = ""
  let i = 0
  while (i < line.length) {
    if (mode === "block") {
      const end = line.indexOf("*/", i)
      if (end === -1) return { body: out, mode }
      mode = "code"
      i = end + 2
      continue
    }
    if (mode === "template") {
      if (line[i] === "\\") {
        i += 2
        continue
      }
      if (line[i] === "`") {
        out += "S"
        mode = "code"
      }
      i += 1
      continue
    }
    const char = line[i]
    if (char === "/" && line[i + 1] === "/") break
    if (char === "/" && line[i + 1] === "*") {
      mode = "block"
      i += 2
      continue
    }
    if (char === '"' || char === "'") {
      // consume to the closing quote on this line; an unterminated string ends at EOL
      let end = i + 1
      while (end < line.length && line[end] !== char) end += line[end] === "\\" ? 2 : 1
      out += "S"
      i = end + 1
      continue
    }
    if (char === "`") {
      mode = "template"
      i += 1
      continue
    }
    out += char
    i += 1
  }
  return { body: out, mode }
}

/**
 * Finds clusters of near-identical code: windows of `window` normalized rows
 * that appear at two or more distinct sites. Groups fully covered by their
 * predecessor window are subsumed, and surviving groups are extended forward
 * to maximal length, so a long duplicate reports once instead of per offset.
 */
export function clusters(files: Record<string, string>, window = WINDOW) {
  const names = Object.keys(files).sort()
  const rows = new Map(names.map((name) => [name, normalize(files[name])]))
  const keys = new Map<string, string[]>()
  for (const name of names) {
    const list = rows.get(name) ?? []
    const texts = list.map((row) => row.text)
    keys.set(
      name,
      texts.map((_, index) => (index + window <= texts.length ? texts.slice(index, index + window).join("\n") : "")),
    )
  }
  const groups = new Map<string, { file: string; index: number }[]>()
  for (const name of names) {
    const list = keys.get(name) ?? []
    list.forEach((key, index) => {
      if (key === "") return
      const found = groups.get(key)
      if (found) {
        found.push({ file: name, index })
        return
      }
      groups.set(key, [{ file: name, index }])
    })
  }
  const results: Cluster[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    if (subsumed(members, keys, groups)) continue
    const length = extent(members, keys, window)
    const sites = members.map((member) => {
      const list = rows.get(member.file) ?? []
      return { file: member.file, start: list[member.index].line, end: list[member.index + length - 1].line }
    })
    results.push({ sites: dedupe(sites), lines: length })
  }
  return results
    .filter((cluster) => cluster.sites.length > 1)
    .sort((a, b) => b.lines * (b.sites.length - 1) - a.lines * (a.sites.length - 1) || compare(a, b))
}

/**
 * True when a longer cluster already covers this one: every member's preceding
 * window exists, all share one key, and that predecessor group has exactly the
 * same members. A larger predecessor group does not subsume, because a subgroup
 * that diverged from it can extend farther and must be reported on its own.
 */
function subsumed(
  members: { file: string; index: number }[],
  keys: Map<string, string[]>,
  groups: Map<string, { file: string; index: number }[]>,
) {
  const previous = members.map((member) => (member.index > 0 ? (keys.get(member.file) ?? [])[member.index - 1] : ""))
  if (previous.some((key) => key === "" || key === undefined)) return false
  if (new Set(previous).size !== 1) return false
  // each member's predecessor is in that group by construction, so equal size means equal membership
  return (groups.get(previous[0]) ?? []).length === members.length
}

/** Number of normalized rows the cluster spans once extended while every member keeps matching. */
function extent(members: { file: string; index: number }[], keys: Map<string, string[]>, window: number) {
  let offset = 1
  while (true) {
    const next = members.map((member) => (keys.get(member.file) ?? [])[member.index + offset])
    if (next.some((key) => key === "" || key === undefined)) break
    if (new Set(next).size !== 1) break
    offset += 1
  }
  return window + offset - 1
}

function dedupe(sites: Site[]) {
  const unique = new Map(sites.map((site) => [`${site.file}\u0000${site.start}`, site]))
  return [...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start)
}

function compare(a: Cluster, b: Cluster) {
  return `${a.sites[0].file}:${a.sites[0].start}`.localeCompare(`${b.sites[0].file}:${b.sites[0].start}`)
}

/** Renders ranked clusters as markdown, capped at `limit` entries. */
export function markdown(results: Cluster[], limit = LIMIT) {
  if (results.length === 0) return "# Duplicate logic\n\nNo near-identical blocks found.\n"
  const sections = results
    .slice(0, limit)
    .flatMap((cluster, index) => [
      `## ${index + 1}. ${cluster.sites.length} sites, ~${cluster.lines} lines each`,
      "",
      ...cluster.sites.map((site) => `- \`${site.file}:${site.start}-${site.end}\``),
      "",
    ])
  return ["# Duplicate logic", "", `${results.length} clusters found.`, "", ...sections].join("\n")
}

export const DupesCommand = effectCmd({
  command: "dupes",
  describe: "find near-identical code blocks across the repo",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("window", {
        describe: "minimum duplicate size in normalized lines",
        type: "number",
        default: WINDOW,
      })
      .option("limit", {
        describe: "maximum clusters to report",
        type: "number",
        default: LIMIT,
      }),
  handler: Effect.fn("Cli.dupes")(function* (args) {
    if (!Number.isFinite(args.window) || !Number.isFinite(args.limit))
      return yield* fail("--window and --limit must be finite numbers")
    const fs = yield* FSUtil.Service
    const cwd = process.cwd()
    const names = (yield* Effect.orDie(walk(fs, cwd, ""))).sort()
    const pairs = yield* Effect.orDie(
      Effect.forEach(names, (name) =>
        fs.readFileString(path.join(cwd, name)).pipe(Effect.map((text) => [name, text] as const)),
      ),
    )
    const window = Math.max(3, Math.floor(args.window))
    const found = clusters(Object.fromEntries(pairs), window)
    process.stdout.write(markdown(found, Math.max(1, Math.floor(args.limit))))
    process.stderr.write(`Scanned ${names.length} files, found ${found.length} duplicate clusters\n`)
  }),
})

/** Recursively collects source file paths, pruning hidden and SKIP directories before listing their children. */
function walk(fs: FSUtil.Interface, root: string, prefix: string): Effect.Effect<string[], FSUtil.Error> {
  return fs.readDirectoryEntries(path.join(root, prefix)).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (entry) => {
        if (entry.name.startsWith(".")) return Effect.succeed<string[]>([])
        const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`
        if (entry.type === "directory")
          return SKIP.has(entry.name) ? Effect.succeed<string[]>([]) : walk(fs, root, name)
        if (entry.type === "file" && /\.(ts|tsx|js|jsx)$/.test(entry.name)) return Effect.succeed([name])
        return Effect.succeed<string[]>([])
      }),
    ),
    Effect.map((lists) => lists.flat()),
  )
}
