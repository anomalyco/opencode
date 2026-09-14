import { Effect, FileSystem, Option, Path, Schema } from "effect"
import type { Database } from "./database"
import { state } from "./schema"

const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DRAFT_KEEP_RECENT = 100

const Entries = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const decode = Schema.decodeUnknownOption(Entries)

type Candidate = { name: string; path: string; modified: number; entries: Record<string, unknown> }

// Before the state table existed, every namespace the renderer persisted was an electron-store
// JSON file in userData. Copy them into SQLite once and remove them; this is the only place the
// storage layer touches the filesystem, and it runs before the first renderer request.
export const importLegacyStores = Effect.fn("DesktopStorage.importLegacyStores")(function* (
  db: Database,
  userData: string,
  now = Date.now(),
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const names = (yield* fs.readDirectory(userData).pipe(Effect.orElseSucceed(() => []))).filter(isStoreFile)
  const files = yield* Effect.forEach(
    names,
    Effect.fnUntraced(function* (name) {
      const file = path.join(userData, name)
      const stats = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => undefined))
      if (stats?.type !== "File") return
      const raw = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => undefined))
      if (raw === undefined) return
      const entries = decode(raw)
      if (Option.isNone(entries)) {
        yield* Effect.logWarning("legacy store is not readable, leaving it in place", { name })
        return
      }
      return {
        name,
        path: file,
        modified: Option.getOrElse(stats.mtime, () => new Date(0)).getTime(),
        entries: entries.value,
      } satisfies Candidate
    }),
    { concurrency: 5 },
  )
  const candidates = files.filter((file) => !!file)
  const kept = new Set(
    candidates
      .filter((file) => isDraft(file.name) && Object.keys(file.entries).length > 0)
      .filter((file) => now - file.modified <= DRAFT_RETENTION_MS)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, DRAFT_KEEP_RECENT)
      .map((file) => file.name),
  )
  const rows = candidates
    .filter((file) => !isDraft(file.name) || kept.has(file.name))
    .flatMap((file) =>
      Object.entries(file.entries).map(([key, value]) => ({
        name: file.name,
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
        updated_at: file.modified,
      })),
    )
  // Existing rows win: a file left behind by an interrupted import must not overwrite newer state.
  if (rows.length > 0) {
    db.transaction((tx) => {
      rows.forEach((row) => tx.insert(state).values(row).onConflictDoNothing().run())
    })
  }
  yield* Effect.forEach(candidates, (file) => fs.remove(file.path, { force: true }), {
    concurrency: "unbounded",
    discard: true,
  })
  return { imported: rows.length, removed: candidates.map((file) => file.name) }
})

function isStoreFile(name: string) {
  return name === "default.dat" || /^opencode\..+\.dat$/.test(name)
}

function isDraft(name: string) {
  return name.startsWith("opencode.draft.")
}
