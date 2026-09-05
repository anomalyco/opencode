export * as NotebookStore from "./store"

import { dirname, join, relative, resolve, sep } from "path"
import { Effect, Option } from "effect"
import { FSUtil } from "../fs-util"
import {
  NOTEBOOK_NAME,
  SKIP_DIRS,
  emptyNotebook,
  parseNotebook,
  type BasedOn,
  type Freshness,
} from "./notebook"

export type SkeletonEntry = {
  rel: string
  dirs: number
  files: number
  sample: string[]
}

const asPosix = (value: string) => value.replaceAll("\\", "/")

/** Recursively lists every `.note.yaml` under `dir`, skipping hidden and known build dirs. */
export function listNotebooks(fs: FSUtil.Interface, dir: string) {
  const found: string[] = []
  const walk = (current: string): Effect.Effect<void> =>
    fs.readDirectoryEntries(current).pipe(
      Effect.catch(() => Effect.succeed<FSUtil.DirEntry[]>([])),
      Effect.flatMap((entries) =>
        Effect.forEach(
          entries,
          (entry) => {
            const abs = join(current, entry.name)
            if (entry.type === "directory") {
              if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) return Effect.void
              return walk(abs)
            }
            if (entry.type === "file" && entry.name === NOTEBOOK_NAME)
              return Effect.sync(() => {
                found.push(abs)
              })
            return Effect.void
          },
          { discard: true },
        ),
      ),
    )
  return walk(dir).pipe(Effect.map(() => found))
}

export function fileFingerprint(fs: FSUtil.Interface, abs: string) {
  return fs.stat(abs).pipe(
    Effect.map((info) => {
      if (info.type !== "File") return null
      const mtime = Option.getOrElse(info.mtime, () => new Date(0)).getTime()
      return `${info.size}-${Math.trunc(mtime)}`
    }),
    Effect.catch(() => Effect.succeed(null)),
  )
}

export function notebookPathFor(root: string, folder: string): string {
  return join(root, folder || ".", NOTEBOOK_NAME)
}

export function loadNotebook(fs: FSUtil.Interface, abs: string, rel: string) {
  return fs.readFileStringSafe(abs).pipe(
    Effect.map((content) =>
      content === undefined ? emptyNotebook(dirname(abs), rel) : parseNotebook(content, dirname(abs), rel),
    ),
  )
}

export function allNotebooks(fs: FSUtil.Interface, root: string) {
  const toRel = (abs: string) => {
    const rel = asPosix(relative(root, dirname(abs))).replace(/\/\.$/, "")
    return rel === "." ? "" : rel
  }
  return listNotebooks(fs, root).pipe(
    Effect.flatMap((paths) =>
      Effect.forEach(paths, (abs) => loadNotebook(fs, abs, toRel(abs)), { concurrency: "unbounded" }),
    ),
  )
}

export function hydrateBasedOn(fs: FSUtil.Interface, root: string, list: ReadonlyArray<string>) {
  return Effect.forEach(
    list,
    (item) => {
      const idx = item.lastIndexOf("@")
      const file = idx === -1 ? item : item.slice(0, idx)
      const hash = idx === -1 ? "" : item.slice(idx + 1)
      const resolved = resolve(root, file)
      if (!resolved.startsWith(resolve(root) + sep)) return Effect.succeed<BasedOn>([])
      const rel = asPosix(relative(root, resolved))
      if (hash) return Effect.succeed([`${rel}@${hash}`])
      return fileFingerprint(fs, join(root, rel)).pipe(
        Effect.map((fp) => (fp === null ? [rel] : [`${rel}@${fp}`])),
      )
    },
  ).pipe(Effect.map((groups) => Array.from(new Set(groups.flat()))))
}

export function itemFreshness(fs: FSUtil.Interface, root: string, basedOn: BasedOn) {
  if (basedOn.length === 0) return Effect.succeed<Freshness>("fresh")
  return Effect.forEach(
    basedOn,
    (item) => {
      const idx = item.lastIndexOf("@")
      const file = idx === -1 ? item : item.slice(0, idx)
      const hash = idx === -1 ? "" : item.slice(idx + 1)
      return fileFingerprint(fs, join(root, file)).pipe(
        Effect.map((fp) => {
          if (fp === null) return "stale" as const
          if (hash && fp !== hash) return "suspect" as const
          return "fresh" as const
        }),
      )
    },
  ).pipe(
    Effect.map((states) => {
      if (states.some((state) => state === "stale")) return "stale"
      if (states.some((state) => state === "suspect")) return "suspect"
      return "fresh"
    }),
  )
}

export function buildSkeleton(fs: FSUtil.Interface, root: string, maxDirs = 40) {
  return fs.readDirectoryEntries(root).pipe(
    Effect.catch(() => Effect.succeed([])),
    Effect.flatMap((entries) =>
      Effect.forEach(
        entries
          .filter((entry) => entry.type === "directory")
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, maxDirs)
          .map((entry) => entry.name),
        (name) => {
          if (name.startsWith(".") || SKIP_DIRS.has(name)) return Effect.succeed<SkeletonEntry[]>([])
          const abs = join(root, name)
          return Effect.map(Effect.all([countDir(fs, abs), sampleFiles(fs, abs, 4)]), ([counts, sample]) => [
            { rel: name, dirs: counts.dirs, files: counts.files, sample },
          ])
        },
      ),
    ),
    Effect.map((rows) => rows.flat()),
  )
}

function countDir(fs: FSUtil.Interface, dir: string): Effect.Effect<{ dirs: number; files: number }> {
  return fs.readDirectoryEntries(dir).pipe(
    Effect.catch(() => Effect.succeed([])),
    Effect.flatMap((entries) =>
      Effect.forEach(
        entries,
        (entry) => {
          if (entry.type !== "directory") return Effect.succeed({ dirs: 0, files: 0 })
          return countDir(fs, join(dir, entry.name)).pipe(
            Effect.map((sub) => ({ dirs: sub.dirs + 1, files: sub.files })),
          )
        },
      ),
    ),
    Effect.map((rows) =>
      rows.reduce((acc, row) => ({ dirs: acc.dirs + row.dirs, files: acc.files + row.files }), {
        dirs: 0,
        files: 0,
      }),
    ),
  )
}

function sampleFiles(fs: FSUtil.Interface, dir: string, n: number) {
  return fs.readDirectoryEntries(dir).pipe(
    Effect.catch(() => Effect.succeed([])),
    Effect.map((entries) =>
      entries
        .filter((entry) => entry.type === "file" && !entry.name.startsWith("."))
        .slice(0, n)
        .map((entry) => entry.name),
    ),
  )
}
