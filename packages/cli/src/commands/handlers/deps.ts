import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { effectCmd, fail } from "../effect-cmd"

const SKIP = new Set([".git", "node_modules", "dist", "build", ".turbo"])
const REGISTRY = "https://registry.npmjs.org"
const ADVISORIES = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk"
const STALE_DAYS = 730
const CONCURRENCY = 8
const DAY = 24 * 60 * 60 * 1000

export type Meta = { latest: string; modified: string; deprecated: boolean }
export type Advisory = { severity: string; title: string }
export type Row = {
  name: string
  current: string
  latest: string
  behind: string
  deprecated: boolean
  stale: number
  advisories: Advisory[]
  score: number
}

/**
 * External dependencies declared across a set of package.json contents,
 * mapped to a comparable pinned version (range operators stripped). Workspace
 * packages and non-registry specifiers are excluded.
 */
export function declared(manifests: Record<string, unknown>) {
  const internal = new Set(
    Object.values(manifests).flatMap((manifest) => {
      const name = (manifest as { name?: unknown }).name
      return typeof name === "string" ? [name] : []
    }),
  )
  const result = new Map<string, string>()
  for (const file of Object.keys(manifests).sort()) {
    const manifest = manifests[file] as { dependencies?: unknown; devDependencies?: unknown }
    for (const group of [manifest.dependencies, manifest.devDependencies]) {
      if (typeof group !== "object" || group === null) continue
      for (const [name, range] of Object.entries(group)) {
        if (internal.has(name) || typeof range !== "string") continue
        const version = range.replace(/^[~^>=<\s]+/, "")
        if (!/^\d+\.\d+\.\d+/.test(version)) continue
        if (!result.has(name)) result.set(name, version)
      }
    }
  }
  return result
}

/** How far `current` trails `latest`: major, minor, patch, current, or unknown for unparseable versions. */
export function behind(current: string, latest: string) {
  const parse = (version: string) =>
    version
      .match(/^(\d+)\.(\d+)\.(\d+)/)
      ?.slice(1, 4)
      .map(Number)
  const now = parse(current)
  const top = parse(latest)
  if (!now || !top) return "unknown"
  if (top[0] > now[0]) return "major"
  if (top[0] === now[0] && top[1] > now[1]) return "minor"
  if (top[0] === now[0] && top[1] === now[1] && top[2] > now[2]) return "patch"
  return "current"
}

/**
 * Joins declared versions with registry metadata and advisories into ranked
 * findings: vulnerable packages first, then deprecated, then abandoned (no
 * publish within the staleness window), then outdated by distance. Healthy
 * packages are dropped.
 */
export function report(
  deps: Map<string, string>,
  meta: Map<string, Meta>,
  advisories: Map<string, Advisory[]>,
  now: number,
) {
  return [...deps.entries()]
    .flatMap(([name, current]) => {
      const info = meta.get(name)
      if (!info) return []
      const found = advisories.get(name) ?? []
      const distance = behind(current, info.latest)
      const modified = Date.parse(info.modified)
      const stale = Number.isNaN(modified) ? 0 : Math.max(0, Math.floor((now - modified) / DAY))
      const abandoned = stale >= STALE_DAYS
      const score =
        found.length * 1000 +
        (info.deprecated ? 500 : 0) +
        (abandoned ? 250 : 0) +
        { major: 100, minor: 10, patch: 1, current: 0, unknown: 0 }[distance]
      if (score === 0) return []
      return [
        {
          name,
          current,
          latest: info.latest,
          behind: distance,
          deprecated: info.deprecated,
          stale,
          advisories: found,
          score,
        },
      ]
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

/** Renders findings as a markdown table with a health summary line. */
export function markdown(rows: Row[], total: number) {
  if (rows.length === 0) return `# Dependency health\n\nAll ${total} dependencies look healthy.\n`
  const lines = rows.map((row) => {
    const flags = [
      ...row.advisories.map((advisory) => `${advisory.severity}: ${advisory.title}`),
      ...(row.deprecated ? ["deprecated"] : []),
      ...(row.stale >= STALE_DAYS ? [`no publish in ${Math.floor(row.stale / 365)}y`] : []),
    ]
    return `| \`${row.name}\` | ${row.current} | ${row.latest} | ${row.behind} | ${flags.join("; ") || "-"} |`
  })
  return [
    "# Dependency health",
    "",
    `${rows.length} of ${total} dependencies need attention; riskiest first.`,
    "",
    "| Package | Declared | Latest | Behind | Flags |",
    "| --- | --- | --- | --- | --- |",
    ...lines,
    "",
  ].join("\n")
}

async function metadata(name: string) {
  const response = await fetch(`${REGISTRY}/${name}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  })
  if (!response.ok) return undefined
  const body = (await response.json()) as {
    "dist-tags"?: Record<string, string>
    modified?: string
    versions?: Record<string, { deprecated?: unknown }>
  }
  const latest = body["dist-tags"]?.latest
  if (!latest) return undefined
  const deprecated = body.versions?.[latest]?.deprecated
  return { latest, modified: body.modified ?? "", deprecated: typeof deprecated === "string" || deprecated === true }
}

async function audit(deps: Map<string, string>) {
  const body = Object.fromEntries([...deps.entries()].map(([name, version]) => [name, [version]]))
  const response = await fetch(ADVISORIES, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) return new Map<string, Advisory[]>()
  const parsed = (await response.json()) as Record<string, { severity?: string; title?: string }[]>
  return new Map(
    Object.entries(parsed).map(([name, list]) => [
      name,
      list.map((entry) => ({ severity: entry.severity ?? "unknown", title: entry.title ?? "advisory" })),
    ]),
  )
}

export const DepsCommand = effectCmd({
  command: "deps",
  describe: "report outdated, vulnerable, deprecated, and abandoned dependencies",
  instance: false,
  handler: Effect.fn("Cli.deps")(function* () {
    const cwd = process.cwd()
    const glob = new Bun.Glob("**/package.json")
    const scanned = yield* Effect.promise(() => Array.fromAsync(glob.scan({ cwd })))
    const names = scanned
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => !name.split("/").some((part) => SKIP.has(part)))
      .sort()
    const manifests: Record<string, unknown> = {}
    for (const name of names) {
      const raw = yield* Effect.promise(() => Bun.file(path.join(cwd, name)).text())
      const parsed = Schema.decodeOption(Schema.UnknownFromJsonString)(raw)
      if (Option.isSome(parsed)) manifests[name] = parsed.value
    }
    const deps = declared(manifests)
    if (deps.size === 0) return yield* fail("No registry dependencies found in package.json files")
    process.stderr.write(`Checking ${deps.size} dependencies against the npm registry...\n`)
    const meta = new Map<string, Meta>()
    const pending = [...deps.keys()]
    const results = yield* Effect.promise(() => {
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        const found: [string, Meta][] = []
        while (pending.length > 0) {
          const name = pending.pop()
          if (!name) break
          const info = await metadata(name)
          if (info) found.push([name, info])
        }
        return found
      })
      return Promise.all(workers)
    })
    for (const chunk of results) {
      for (const entry of chunk) meta.set(entry[0], entry[1])
    }
    const advisories = yield* Effect.promise(() => audit(deps))
    const rows = report(deps, meta, advisories, Date.now())
    process.stdout.write(markdown(rows, deps.size))
    process.stderr.write(`Flagged ${rows.length} of ${deps.size} dependencies\n`)
  }),
})
