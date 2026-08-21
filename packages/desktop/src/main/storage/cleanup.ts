import { Effect, FileSystem, Option, Path } from "effect"

const EMPTY_STORE_MAX_BYTES = 128
const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DRAFT_KEEP_RECENT = 100

type StoreKind = "draft" | "workspace"
type StoreCandidate = {
  name: string
  path: string
  kind: StoreKind
  modified: number
  empty: boolean
}

export const cleanupStoreFiles = Effect.fn("Storage.cleanupStoreFiles")(function* (
  userDataPath: string,
  now = Date.now(),
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const entries = yield* fs.readDirectory(userDataPath).pipe(Effect.catch(() => Effect.succeed([])))
  const candidates = (yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* (entry) {
      const kind = storeKind(entry)
      if (!kind) return

      const file = path.join(userDataPath, entry)
      const stats = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (stats?.type !== "File") return

      return {
        name: entry,
        path: file,
        kind,
        modified: Option.getOrElse(stats.mtime, () => new Date(0)).getTime(),
        empty: yield* isEmptyStore(file, stats.size),
      }
    }),
    { concurrency: 5 },
  )).filter((candidate) => !!candidate)

  const stale = new Set<StoreCandidate>()
  for (const candidate of candidates) {
    if (candidate.empty) stale.add(candidate)
    if (candidate.kind === "draft" && now - candidate.modified > DRAFT_RETENTION_MS) stale.add(candidate)
  }

  candidates
    .filter((candidate) => candidate.kind === "draft" && !candidate.empty)
    .sort((a, b) => b.modified - a.modified)
    .slice(DRAFT_KEEP_RECENT)
    .forEach((candidate) => stale.add(candidate))

  const deleted = yield* Effect.forEach(
    stale,
    Effect.fnUntraced(function* (candidate) {
      yield* fs.remove(candidate.path, { force: true })
      return candidate.name
    }),
    { concurrency: "unbounded" },
  )

  return { scanned: candidates.length, deleted }
})

export const deleteStoreFileIfEmpty = Effect.fn("Storage.deleteStoreFileIfEmpty")(function* (
  userDataPath: string,
  name: string,
) {
  if (!storeKind(name)) return false

  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join(userDataPath, name)
  const stats = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (stats?.type !== "File") return false
  if (!(yield* isEmptyStore(file, stats.size))) return false

  yield* fs.remove(file, { force: true })
  return true
})

function storeKind(name: string): StoreKind | undefined {
  if (/^opencode\.draft\..+\.dat$/.test(name)) return "draft"
  if (/^opencode\.workspace\..+\.dat$/.test(name)) return "workspace"
}

const isEmptyStore = Effect.fn("Storage.isEmptyStore")(function* (file: string, size: FileSystem.Size) {
  if (size > FileSystem.Size(EMPTY_STORE_MAX_BYTES)) return false

  const fs = yield* FileSystem.FileSystem
  const raw = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (raw === undefined) return false
  if (raw.trim() === "") return true

  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length === 0
  } catch {
    return false
  }
})
