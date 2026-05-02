import { Effect, Path } from "effect"
import ignore from "ignore"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { FileIgnore } from "../file/ignore"
import { errorMessage } from "../util/error"

const log = Log.create({ service: "worktree.include" })

export const FILENAME = ".worktreeinclude"

// Hard-skip: never recurse into a `.git` directory regardless of user patterns.
// Other heavy directories (node_modules, dist, …) are pruned via FileIgnore.match
// below so users can override by listing them explicitly in `.worktreeinclude`.
const HARD_SKIP_DIRECTORIES = new Set([".git"])

const COPY_CONCURRENCY = 8

export interface ApplyResult {
  readonly copied: string[]
  readonly failed: { path: string; error: string }[]
}

const copyFileEntry = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  pathSvc: Path.Path,
  src: string,
  dst: string,
  type: AppFileSystem.DirEntry["type"],
) {
  const parent = pathSvc.dirname(dst)
  yield* fs.makeDirectory(parent, { recursive: true })

  if (type === "symlink") {
    const target = yield* fs.readLink(src)
    yield* fs.remove(dst, { recursive: true, force: true } as any).pipe(Effect.catch(() => Effect.void))
    yield* fs.symlink(target, dst)
    return
  }

  yield* fs.copyFile(src, dst)
  const info = yield* fs.stat(src).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const mode = info?.mode
  if (typeof mode === "number") {
    yield* fs.chmod(dst, mode).pipe(Effect.catch(() => Effect.void))
  }
})

// Internal helpers explicitly type their R channel as `never` so that
// `apply` does not accidentally bubble up an `any` requirement to its callers.
type IncludeEffect<A> = Effect.Effect<A, any, never>

function copyDirectoryRecursive(
  fs: AppFileSystem.Interface,
  pathSvc: Path.Path,
  src: string,
  dst: string,
): IncludeEffect<void> {
  return Effect.gen(function* () {
    yield* fs.makeDirectory(dst, { recursive: true })
    const entries = yield* fs
      .readDirectoryEntries(src)
      .pipe(Effect.catch(() => Effect.succeed([] as AppFileSystem.DirEntry[])))
    for (const entry of entries) {
      if (HARD_SKIP_DIRECTORIES.has(entry.name)) continue
      const childSrc = pathSvc.join(src, entry.name)
      const childDst = pathSvc.join(dst, entry.name)
      if (entry.type === "directory") {
        yield* copyDirectoryRecursive(fs, pathSvc, childSrc, childDst)
      } else {
        yield* copyFileEntry(fs, pathSvc, childSrc, childDst, entry.type)
      }
    }
  })
}

const copyOne = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  pathSvc: Path.Path,
  source: string,
  destination: string,
  rel: string,
  type: AppFileSystem.DirEntry["type"],
) {
  const src = pathSvc.join(source, rel)
  const dst = pathSvc.join(destination, rel)

  if (type === "directory") {
    const parent = pathSvc.dirname(dst)
    yield* fs.makeDirectory(parent, { recursive: true })
    yield* copyDirectoryRecursive(fs, pathSvc, src, dst)
    return
  }

  yield* copyFileEntry(fs, pathSvc, src, dst, type)
})

type Match = { rel: string; type: AppFileSystem.DirEntry["type"] }

function visitForMatches(
  fs: AppFileSystem.Interface,
  pathSvc: Path.Path,
  source: string,
  matcher: ReturnType<typeof ignore>,
  relDir: string,
  matches: Match[],
): IncludeEffect<void> {
  return Effect.gen(function* () {
    const absDir = relDir ? pathSvc.join(source, relDir) : source
    const entries = yield* fs
      .readDirectoryEntries(absDir)
      .pipe(Effect.catch(() => Effect.succeed([] as AppFileSystem.DirEntry[])))

    for (const entry of entries) {
      if (HARD_SKIP_DIRECTORIES.has(entry.name)) continue

      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      const isDir = entry.type === "directory"
      const probe = isDir ? `${rel}/` : rel

      if (matcher.ignores(probe)) {
        // User explicitly matched this entry. For directories we copy wholesale;
        // descendants are handled by `copyDirectoryRecursive`.
        matches.push({ rel, type: entry.type })
        continue
      }

      if (isDir) {
        // Skip standard build/cache directories so monorepos don't blow up walk
        // time. Users can override by listing the directory in `.worktreeinclude`
        // (matched above before this prune fires).
        if (FileIgnore.match(rel)) continue
        yield* visitForMatches(fs, pathSvc, source, matcher, rel, matches)
      }
    }
  })
}

const walk = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  pathSvc: Path.Path,
  source: string,
  matcher: ReturnType<typeof ignore>,
) {
  const matches: Match[] = []
  yield* visitForMatches(fs, pathSvc, source, matcher, "", matches)
  return matches
})

export const apply = Effect.fn("Worktree.includeIgnored")(function* (input: {
  source: string
  destination: string
  fs: AppFileSystem.Interface
  pathSvc: Path.Path
}) {
  const { fs, pathSvc } = input

  const includeFile = pathSvc.join(input.source, FILENAME)
  const text = yield* fs.readFileString(includeFile).pipe(Effect.catch(() => Effect.succeed("")))
  const trimmed = text.trim()
  const empty: ApplyResult = { copied: [], failed: [] }
  if (!trimmed) {
    log.debug("worktreeinclude: no patterns", {
      source: input.source,
      destination: input.destination,
      includeFile,
      hasFile: text.length > 0,
    })
    return empty
  }

  log.debug("worktreeinclude: scanning", {
    source: input.source,
    destination: input.destination,
    patternBytes: trimmed.length,
  })

  const matcher = ignore().add(text)
  const matched = yield* walk(fs, pathSvc, input.source, matcher)
  if (!matched.length) {
    log.debug("worktreeinclude: no matches", { source: input.source })
    return empty
  }

  const copied: string[] = []
  const failed: { path: string; error: string }[] = []

  yield* Effect.forEach(
    matched,
    (item) =>
      copyOne(fs, pathSvc, input.source, input.destination, item.rel, item.type).pipe(
        Effect.tap(() => Effect.sync(() => copied.push(item.rel))),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            failed.push({ path: item.rel, error: errorMessage(cause) })
            log.warn("worktreeinclude copy failed", { path: item.rel, cause: errorMessage(cause) })
          }),
        ),
      ),
    { concurrency: COPY_CONCURRENCY, discard: true },
  )

  return { copied, failed } satisfies ApplyResult
})

export * as WorktreeInclude from "./include"
