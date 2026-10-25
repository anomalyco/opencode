import path from "node:path"
import fs from "node:fs"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { SemanticRank } from "../../tool/semantic-rank"

const SKIP = new Set([".git", "node_modules", "dist", "build", ".turbo"])
const MATCH = /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py|rb|java|kt|c|h|cc|cpp|hpp|cs|php|swift|sh)$/
const DIMENSIONS = 128
const MAX_BYTES = 200_000
const LIMIT = 10
const SETTLE_MS = 200
const OUT = "codebase-index.json"

export type Entry = { hash: string; chunks: { start: number; end: number; vector: number[] }[] }
export type Index = { version: 1; files: Record<string, Entry> }
export type Stats = { added: number; updated: number; removed: number; unchanged: number }
export type Hit = { file: string; start: number; end: number; score: number }

/** 32-bit FNV-1a. Used both for change digests and for hashing tokens into vector buckets. */
export function fnv(text: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Cheap content digest for incremental updates: hash plus length, so touched-but-identical files are skipped. */
export function digest(text: string) {
  return `${fnv(text).toString(36)}-${text.length}`
}

/**
 * Feature-hashed embedding of a chunk: SemanticRank's definition-weighted term
 * frequencies are hashed into a fixed number of buckets and L2-normalized, so
 * similarity is a plain dot product. Deterministic and fully local; a model
 * embedding backend can replace this without changing the index shape.
 */
export function vector(text: string) {
  const buckets = new Array<number>(DIMENSIONS).fill(0)
  for (const [token, weight] of SemanticRank.weights(text)) {
    buckets[fnv(token) % DIMENSIONS] += weight
  }
  const norm = Math.sqrt(buckets.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return buckets
  return buckets.map((value) => Math.round((value / norm) * 1e4) / 1e4)
}

/**
 * Incrementally reconciles the index against current file contents. Files with
 * an unchanged digest keep their stored chunk vectors untouched; new and
 * changed files are re-chunked and re-embedded; missing files are dropped.
 */
export function refresh(index: Index, files: Record<string, string>) {
  const stats: Stats = { added: 0, updated: 0, removed: 0, unchanged: 0 }
  const next: Record<string, Entry> = {}
  for (const name of Object.keys(files).sort()) {
    const hash = digest(files[name])
    const previous = index.files[name]
    if (previous && previous.hash === hash) {
      next[name] = previous
      stats.unchanged += 1
      continue
    }
    next[name] = {
      hash,
      chunks: SemanticRank.chunk(name, files[name]).map((item) => ({
        start: item.start,
        end: item.end,
        vector: vector(item.text),
      })),
    }
    if (previous) stats.updated += 1
    if (!previous) stats.added += 1
  }
  stats.removed = Object.keys(index.files).filter((name) => !(name in files)).length
  return { index: { version: 1 as const, files: next }, stats }
}

/** Top chunks by cosine similarity to the query, embedded with the same hashing scheme. */
export function query(index: Index, text: string, limit = LIMIT) {
  const probe = vector(text)
  return Object.keys(index.files)
    .flatMap((name) =>
      index.files[name].chunks.map((item) => ({
        file: name,
        start: item.start,
        end: item.end,
        score: item.vector.reduce((sum, value, position) => sum + value * probe[position], 0),
      })),
    )
    .filter((hit) => hit.score > 0)
    .toSorted((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.start - b.start)
    .slice(0, limit)
}

/** Renders hits one per line: score, then file:start-end. */
export function render(hits: Hit[]) {
  if (hits.length === 0) return "No matches.\n"
  return hits.map((hit) => `${hit.score.toFixed(3)} ${hit.file}:${hit.start}-${hit.end}`).join("\n") + "\n"
}

/** True for indexable source paths outside skipped directories. */
export function indexable(name: string) {
  if (name.split("/").some((part) => SKIP.has(part))) return false
  return MATCH.test(name)
}

export const IndexCommand = effectCmd({
  command: "index [query]",
  describe: "build an incrementally updated whole-repo vector index and query it",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("query", { describe: "search the index instead of only building it", type: "string" })
      .option("out", { describe: "index file path", type: "string", default: OUT })
      .option("limit", { describe: "maximum search hits", type: "number", default: LIMIT })
      .option("watch", {
        describe: "keep running and reindex files as they are saved",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.index")(function* (args) {
    const cwd = process.cwd()
    const out = path.join(cwd, args.out)
    const stored = yield* Effect.promise(async () => {
      const handle = Bun.file(out)
      if (!(await handle.exists())) return { version: 1 as const, files: {} }
      return (await handle.json()) as Index
    })
    const scanned = yield* Effect.promise(() => Array.fromAsync(new Bun.Glob("**/*").scan({ cwd })))
    const names = scanned
      .map((name) => name.replaceAll("\\", "/"))
      .filter(indexable)
      .sort()
    const files: Record<string, string> = {}
    for (const name of names) {
      const handle = Bun.file(path.join(cwd, name))
      if (handle.size > MAX_BYTES) continue
      files[name] = yield* Effect.promise(() => handle.text())
    }
    const first = refresh(stored, files)
    yield* Effect.promise(() => Bun.write(out, JSON.stringify(first.index)))
    process.stderr.write(
      `Indexed ${Object.keys(first.index.files).length} files (+${first.stats.added} ~${first.stats.updated} -${first.stats.removed} =${first.stats.unchanged}) to ${args.out}\n`,
    )
    if (args.query) process.stdout.write(render(query(first.index, args.query, Math.max(1, Math.floor(args.limit)))))
    if (!args.watch) return

    let current = first.index
    let notify: (() => void) | undefined
    const changed = new Set<string>()
    const watcher = fs.watch(cwd, { recursive: true }, (_, name) => {
      if (!name) return
      const clean = name.replaceAll("\\", "/")
      if (!indexable(clean)) return
      changed.add(clean)
      notify?.()
    })
    process.stderr.write("Watching for saves, ctrl-c to stop\n")
    const loop = Effect.promise(async () => {
      while (true) {
        await new Promise<void>((resolve) => {
          if (changed.size > 0) return resolve()
          notify = resolve
        })
        await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS))
        const batch = [...changed]
        changed.clear()
        for (const name of batch) {
          const handle = Bun.file(path.join(cwd, name))
          const exists = await handle.exists()
          if (!exists || handle.size > MAX_BYTES) {
            delete files[name]
            continue
          }
          files[name] = await handle.text()
        }
        const result = refresh(current, files)
        current = result.index
        await Bun.write(out, JSON.stringify(current))
        process.stderr.write(
          `Reindexed (+${result.stats.added} ~${result.stats.updated} -${result.stats.removed} =${result.stats.unchanged})\n`,
        )
      }
    })
    yield* loop.pipe(Effect.ensuring(Effect.sync(() => watcher.close())))
  }),
})
