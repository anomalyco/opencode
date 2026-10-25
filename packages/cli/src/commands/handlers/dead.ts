import path from "node:path"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"

const SKIP = new Set([".git", "node_modules", "dist", "build", ".turbo"])
const LIMIT = 40
const WORD = /[A-Za-z_$][A-Za-z0-9_$]*/g
const DECLARATION =
  /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/
const BRACES = /^\s*export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/
const IMPORTED = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from/g
const STAR = /export\s+\*\s+(?:as\s+[A-Za-z_$][A-Za-z0-9_$]*\s+)?from\s+['"]([^'"]+)['"]/g

export type Exported = { file: string; name: string; line: number }
export type Finding = { file: string; name: string; line: number; score: number; reasons: string[] }

/** Named exports declared in `text`: declarations and local `export { a, b }` lists, with 1-based lines. */
export function exports(file: string, text: string) {
  return text.split("\n").flatMap((raw, index) => {
    const declared = raw.match(DECLARATION)
    if (declared) return [{ file, name: declared[1], line: index + 1 }]
    const listed = raw.match(BRACES)
    if (!listed) return []
    return listed[1]
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => ({ file, name: part.split(/\s+as\s+/).pop() ?? part, line: index + 1 }))
  })
}

/** Every identifier named in an `import {...} from` or `export {...} from` clause anywhere in `text`. */
export function imported(text: string) {
  return [...text.matchAll(IMPORTED)].flatMap((match) =>
    match[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0])
      .filter((part) => part.length > 0),
  )
}

/** Files that `text` re-exports wholesale via `export * from` / `export * as X from`, resolved against `known`. */
export function starred(file: string, text: string, known: Set<string>) {
  const dir = path.posix.dirname(file)
  return [...text.matchAll(STAR)].flatMap((match) => {
    if (!match[1].startsWith(".")) return []
    const base = path.posix.normalize(path.posix.join(dir, match[1].replace(/\.(ts|tsx|js|jsx)$/, "")))
    const found = ["ts", "tsx", "js", "jsx"]
      .flatMap((ext) => [`${base}.${ext}`, `${base}/index.${ext}`])
      .find((name) => known.has(name))
    if (!found || found === file) return []
    return [found]
  })
}

/** Identifier occurrence counts for a file, used to grade how safe a deletion is. */
export function identifiers(text: string) {
  const counts = new Map<string, number>()
  for (const match of text.match(WORD) ?? []) {
    counts.set(match, (counts.get(match) ?? 0) + 1)
  }
  return counts
}

/**
 * Ranks confidently-unused exports by deletion safety, 0-100. Exports whose
 * name appears in any import clause repo-wide are considered used and never
 * reported; the rest lose points for identifier mentions in other files, star
 * re-exports (unknowable consumers), entrypoint files, and internal usage.
 */
export function radar(files: Record<string, string>) {
  const names = Object.keys(files).sort()
  const known = new Set(names)
  const used = new Set(names.flatMap((name) => imported(files[name])))
  const wildcarded = new Set(names.flatMap((name) => starred(name, files[name], known)))
  const counts = new Map(names.map((name) => [name, identifiers(files[name])]))
  return names
    .flatMap((name) => exports(name, files[name]))
    .filter((entry) => !used.has(entry.name))
    .map((entry) => {
      const reasons: string[] = []
      let score = 100
      const elsewhere = names
        .filter((name) => name !== entry.file)
        .reduce((sum, name) => sum + (counts.get(name)?.get(entry.name) ?? 0), 0)
      if (elsewhere > 0) {
        score -= Math.min(60, elsewhere * 30)
        reasons.push(`name mentioned ${elsewhere}x outside its file`)
      }
      if (wildcarded.has(entry.file)) {
        score -= 40
        reasons.push("file is star re-exported")
      }
      if (/(^|\/)index\.(ts|tsx|js|jsx)$/.test(entry.file)) {
        score -= 30
        reasons.push("index entrypoint")
      }
      if (/\.(test|spec)\.|(^|\/)(test|tests)\//.test(entry.file)) {
        score -= 20
        reasons.push("test file")
      }
      const internal = (counts.get(entry.file)?.get(entry.name) ?? 1) - 1
      if (internal > 0) {
        score -= 10
        reasons.push("used inside its own file; only the export keyword is dead")
      }
      return { file: entry.file, name: entry.name, line: entry.line, score: Math.max(0, score), reasons }
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
}

/** Renders findings as a markdown table ordered by deletion safety. */
export function markdown(findings: Finding[], limit = LIMIT) {
  if (findings.length === 0) return "# Dead code radar\n\nNo unused exports found.\n"
  const rows = findings
    .slice(0, limit)
    .map(
      (finding) =>
        `| \`${finding.name}\` | \`${finding.file}:${finding.line}\` | ${finding.score} | ${finding.reasons.join("; ") || "no references anywhere"} |`,
    )
  return [
    "# Dead code radar",
    "",
    `${findings.length} unused exports, safest deletions first.`,
    "",
    "| Export | Location | Safety | Notes |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n")
}

export const DeadCommand = effectCmd({
  command: "dead",
  describe: "find unused exports ranked by deletion safety",
  instance: false,
  builder: (yargs) =>
    yargs.option("limit", {
      describe: "maximum findings to report",
      type: "number",
      default: LIMIT,
    }),
  handler: Effect.fn("Cli.dead")(function* (args) {
    const cwd = process.cwd()
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}")
    const scanned = yield* Effect.promise(() => Array.fromAsync(glob.scan({ cwd })))
    const names = scanned
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => !name.split("/").some((part) => SKIP.has(part)))
      .sort()
    const files: Record<string, string> = {}
    for (const name of names) {
      files[name] = yield* Effect.promise(() => Bun.file(path.join(cwd, name)).text())
    }
    const findings = radar(files)
    process.stdout.write(markdown(findings, Math.max(1, Math.floor(args.limit))))
    process.stderr.write(`Scanned ${names.length} files, found ${findings.length} unused exports\n`)
  }),
})
