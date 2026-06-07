import path from "path"
import { Context, Deferred, Effect, Layer, Option, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { FSUtil } from "../fs-util"
import { Glob } from "../util/glob"
import { Global } from "../global"
import * as Log from "../util/log"
import { serviceUse } from "../effect/service-use"
import { makeRuntime } from "../effect/runtime"
import { Fff } from "#fff"
import { Ripgrep } from "./ripgrep"

const log = Log.create({ service: "file.search" })
const root = path.join(Global.Path.cache, "fff")

export type Item = Ripgrep.Item
export type SearchError = PlatformError | globalThis.Error

export interface Result {
  readonly items: Item[]
  readonly partial: boolean
  readonly hasNextPage: boolean
  readonly engine: "fff" | "ripgrep"
  readonly regexFallbackError?: string
}

export interface FileInput {
  readonly cwd: string
  readonly query: string
  readonly limit?: number
  readonly current?: string
  readonly kind?: "file" | "directory" | "all"
}

export interface GlobInput {
  readonly cwd: string
  readonly pattern: string
  readonly limit?: number
  readonly signal?: AbortSignal
}

interface Query {
  readonly dir: string
  readonly text: string
  readonly files: string[]
}

// A created picker plus its cached scan-readiness gate. The picker is created
// (and its native background scan kicked off) eagerly; `ready` is only awaited
// when the picker is actually used.
interface Picker {
  readonly pick: Fff.Picker
  readonly ready: Effect.Effect<void, Error>
}

interface State {
  readonly pick: Map<string, Picker>
  readonly wait: Map<string, Deferred.Deferred<Picker, Error>>
  readonly recent: Query[]
}

export interface Interface {
  readonly files: Ripgrep.Interface["files"]
  readonly tree: Ripgrep.Interface["tree"]
  readonly search: (input: Ripgrep.SearchInput) => Effect.Effect<Result, SearchError>
  readonly file: (input: FileInput) => Effect.Effect<string[] | undefined, SearchError>
  readonly glob: (input: GlobInput) => Effect.Effect<{ files: string[]; truncated: boolean }, SearchError>
  readonly open: (input: { cwd?: string; file: string }) => Effect.Effect<void, SearchError>
  readonly warm: (cwd: string) => Effect.Effect<void>
  // Destroy the picker for a directory and drop its cached state. Called when a
  // directory's instance is disposed so fff's native watcher thread is torn
  // down instead of leaking until process exit.
  readonly release: (cwd: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Search") {}

export const use = serviceUse(Service)

function key(dir: string) {
  return Buffer.from(dir).toString("base64url")
}

function fffSync<A>(action: string, run: () => A) {
  return Effect.try({
    try: run,
    catch: (cause) => new Error(`fff ${action} failed`, { cause }),
  })
}

function normalize(text: string) {
  return text.replaceAll("\\", "/")
}

// fff supports glob narrowing for any search out of the box
function fffGlobbedQuery(query: string, glob?: string | string[]) {
  if (query && glob) {
    const resolvedGlob = Array.isArray(glob) ? glob.join(" ") : glob
    return `${resolvedGlob} ${query}`
  }

  return query ?? glob
}

function remember(state: State, dir: string, text: string, files: string[]) {
  if (!files.length) return
  const next = Array.from(new Set(files.map(FSUtil.resolve))).slice(0, 64)
  if (!next.length) return
  const idx = state.recent.findIndex((item) => item.dir === dir && item.text === text)
  if (idx >= 0) state.recent.splice(idx, 1)
  state.recent.unshift({ dir, text, files: next })
  if (state.recent.length > 32) state.recent.length = 32
}

function item(hit: Fff.Hit): Item {
  const line = Buffer.from(hit.lineContent)
  return {
    path: { text: normalize(hit.relativePath) },
    lines: { text: hit.lineContent },
    line_number: hit.lineNumber,
    absolute_offset: hit.byteOffset,
    submatches: hit.matchRanges
      .map(([start, end]) => {
        const text = line.subarray(start, end).toString("utf8")
        if (!text) return undefined
        return {
          match: { text },
          start,
          end,
        }
      })
      .filter((row): row is Item["submatches"][number] => Boolean(row)),
  }
}

function collectPaths<T>(
  out: { items: T[]; scores: Array<{ total: number }> },
  toPath: (item: T) => string,
  opts?: { includeZeroScore?: boolean },
): string[] {
  return Array.from(
    new Set(
      out.items.flatMap((item, idx): string[] => {
        const score = out.scores[idx]
        if (!score || (!opts?.includeZeroScore && score.total <= 0)) return []
        const text = toPath(item)
        if (!text) return []
        return [text]
      }),
    ),
  )
}

function searchFff(
  pick: Fff.Picker,
  kind: "file" | "directory" | "all",
  query: string,
  opts: { currentFile?: string; pageIndex?: number; pageSize?: number },
): Fff.Result<string[]> {
  if (kind === "directory") {
    const out = pick.directorySearch(query, opts)
    if (!out.ok) return out
    return {
      ok: true,
      value: collectPaths(out.value, (entry) => normalize(entry.relativePath), { includeZeroScore: !query }),
    }
  }
  if (kind === "all") {
    const out = pick.mixedSearch(query, opts)
    if (!out.ok) return out
    return {
      ok: true,
      value: collectPaths(out.value, (entry) => normalize(entry.item.relativePath), { includeZeroScore: !query }),
    }
  }
  const out = pick.fileSearch(query, opts)
  if (!out.ok) return out
  return {
    ok: true,
    value: collectPaths(out.value, (entry) => normalize(entry.relativePath), { includeZeroScore: !query }),
  }
}

export const layer: Layer.Layer<Service, never, FSUtil.Service | Ripgrep.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const rg = yield* Ripgrep.Service

    const state: State = {
      pick: new Map<string, Picker>(),
      wait: new Map<string, Deferred.Deferred<Picker, Error>>(),
      recent: [] as Query[],
    }

    yield* fs.ensureDir(root).pipe(Effect.ignore)
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        state.pick.values(),
        (entry) => fffSync("destroy picker", () => entry.pick.destroy()).pipe(Effect.ignore),
        { discard: true },
      ),
    )

    const rip = Effect.fn("Search.rip")(function* (input: Ripgrep.SearchInput) {
      const out = yield* rg.search(input)
      return {
        items: out.items,
        partial: out.partial,
        hasNextPage: false,
        engine: "ripgrep" as const,
      }
    })

    // Lazy, shared scan-wait for a picker. Preserves the original behavior: if
    // the scan does not finish within the budget the picker is destroyed and
    // dropped from the cache so callers fall back to ripgrep (and the next
    // request recreates a fresh picker).
    const scanReady = (dir: string, pick: Fff.Picker) =>
      Effect.gen(function* () {
        const scanned = yield* Effect.tryPromise({
          try: () => pick.waitForScan(5_000),
          catch: (cause) => new Error("fff waitForScan failed", { cause }),
        })
        if (!scanned.ok || !scanned.value) {
          yield* fffSync("destroy picker", () => pick.destroy()).pipe(Effect.ignore)
          state.pick.delete(dir)
          log.warn("fff scan not ready", { dir })
          return yield* Effect.fail(new Error(scanned.ok ? "fff scan timed out" : scanned.error))
        }

        const git = yield* fffSync("refresh git status", () => pick.refreshGitStatus())
        if (!git.ok) log.warn("fff git refresh failed", { dir, error: git.error })
      })

    // Create (or return) the picker for a directory. Creation is synchronous
    // and does not await the scan; the native background scan starts as soon as
    // the picker exists. The `wait` gate dedupes concurrent creation.
    const acquire = Effect.fn("Search.acquire")(function* (cwd: string) {
      // The opencode test runtime owns an isolated XDG tree that Windows must
      // remove before process exit, so use ripgrep instead of native FFF there.
      if (process.env.OPENCODE_TEST_HOME) return undefined

      const available = yield* fffSync("check availability", () => Fff.available()).pipe(
        Effect.catch((error) => {
          log.warn("fff availability check failed", { error })
          return Effect.succeed(false)
        }),
      )
      if (!available) return undefined

      const dir = FSUtil.resolve(cwd)
      const existing = state.pick.get(dir)
      if (existing) return existing

      const pending = state.wait.get(dir)
      if (pending) return yield* Deferred.await(pending)

      const gate = yield* Deferred.make<Picker, Error>()
      state.wait.set(dir, gate)
      return yield* Effect.gen(function* () {
        const id = key(dir)
        const isFirstPicker = state.pick.size === 0
        const made = yield* fffSync("create picker", () =>
          Fff.create({
            basePath: dir,
            frecencyDbPath: path.join(root, `${id}.frecency.mdb`),
            historyDbPath: path.join(root, `${id}.history.mdb`),
            // fff uses a bit different log version, also with spans so keep
            // them in the same folder for debuggability
            logFilePath: path.join(Global.Path.log, "fff.log"),
            logLevel: Log.getLevel().toLowerCase() as Lowercase<Log.Level>,
            aiMode: true,
            // only the first toolcall picker can accumulate resources to index
            // home directory, if the user specifically opened opencode at the
            // $HOME level or asked it to search there on purpose, otherwise fallback
            enableHomeDirScanning: isFirstPicker,
            // on unix system it is 99.9% that you do not need to search for the
            // content at the / so make fff fail creation and fallback to rg
            enableFsRootScanning: isFirstPicker && process.platform === "win32",
          }),
        )
        if (!made.ok) {
          log.warn("fff init failed", { dir, error: made.error })
          const err = new Error(made.error)
          yield* Deferred.fail(gate, err)
          return yield* Effect.fail(err)
        }

        const pick = made.value
        const entry: Picker = { pick, ready: yield* Effect.cached(scanReady(dir, pick)) }
        state.pick.set(dir, entry)
        yield* Deferred.succeed(gate, entry)
        return entry
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            if (state.wait.get(dir) === gate) state.wait.delete(dir)
            yield* Deferred.fail(gate, new Error("fff init interrupted")).pipe(Effect.ignore)
          }),
        ),
      )
    })

    // Resolve a usable, scanned picker for a directory, or undefined when fff is
    // unavailable or the scan did not become ready.
    const picker = Effect.fn("Search.picker")(function* (cwd: string) {
      const entry = yield* acquire(cwd).pipe(Effect.catch(() => Effect.succeed<Picker | undefined>(undefined)))
      if (!entry) return undefined
      const ready = yield* entry.ready.pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      )
      if (!ready) return undefined
      return entry.pick
    })

    const files: Interface["files"] = (input) => rg.files(input)
    const tree: Interface["tree"] = (input) => rg.tree(input)

    // in 99% of use cases user that is opened opencode at certain directory will
    // conduct a file search in this direcotry, it could be switched later but
    // mostly always we will need a file picker for cwd
    // so synchronously start FFF scan for a cwd so it is ready before first toolcall generated
    const warm: Interface["warm"] = Effect.fn("Search.warm")(function* (cwd) {
      yield* acquire(cwd).pipe(Effect.ignore)
    })

    // Tear down the picker for a directory. fff pickers own a native background
    // watcher thread that otherwise lives until the runtime scope closes (i.e.
    // process exit), so disposing the instance that warmed it must destroy it
    // here or the thread leaks against a directory that may already be gone.
    const release: Interface["release"] = Effect.fn("Search.release")(function* (cwd) {
      const dir = FSUtil.resolve(cwd)

      const pending = state.wait.get(dir)
      if (pending) {
        state.wait.delete(dir)
        yield* Deferred.fail(pending, new Error("fff picker released")).pipe(Effect.ignore)
      }

      const entry = state.pick.get(dir)
      if (entry) {
        state.pick.delete(dir)
        yield* fffSync("destroy picker", () => entry.pick.destroy()).pipe(Effect.ignore)
      }

      const remaining = state.recent.filter((item) => item.dir !== dir)
      state.recent.splice(0, state.recent.length, ...remaining)
    })

    const file: Interface["file"] = Effect.fn("Search.file")(function* (input) {
      const query = input.query.trim()
      const kind = input.kind ?? "file"

      const pick = yield* picker(input.cwd)
      if (!pick) return undefined

      const dir = FSUtil.resolve(input.cwd)
      const limit = input.limit ?? 100
      const fffResult = yield* fffSync(`${kind} search`, () =>
        searchFff(pick, kind, query, {
          pageIndex: 0,
          currentFile: input.current, // supports both relative and absolute (relative preferred)
          pageSize: limit,
        }),
      ).pipe(
        Effect.catch((error) => {
          log.warn(`fff ${kind} search failed`, { dir, query, error })
          return Effect.succeed<Fff.Result<string[]> | undefined>(undefined)
        }),
      )
      if (!fffResult) return undefined
      if (!fffResult.ok) {
        log.warn(`fff ${kind} search failed`, { dir, query, error: fffResult.error })
        return undefined
      }

      const rows = fffResult.value
      remember(
        state,
        dir,
        query,
        rows.map((row) => path.join(dir, row)),
      )
      return rows.slice(0, limit)
    })

    const search: Interface["search"] = Effect.fn("Search.search")(function* (input) {
      input.signal?.throwIfAborted()
      if (input.file?.length) return yield* rip(input)

      const pick = yield* picker(input.cwd)
      if (!pick) return yield* rip(input)

      const dir = FSUtil.resolve(input.cwd)
      const limit = input.limit ?? 100

      const fffGrep = yield* fffSync("grep", () =>
        pick.grep(fffGlobbedQuery(input.pattern, input.glob), {
          mode: "regex",
          pageSize: limit,
          timeBudgetMs: 1_500,
        }),
      ).pipe(
        Effect.catch((error) => {
          log.warn("fff grep failed", { dir, pattern: input.pattern, error })
          return Effect.succeed<Fff.Result<Fff.Grep> | undefined>(undefined)
        }),
      )
      if (!fffGrep) return yield* rip(input)
      if (!fffGrep.ok) {
        log.warn("fff grep failed", { dir, pattern: input.pattern, error: fffGrep.error })
        return yield* rip(input)
      }

      const rows: Item[] = fffGrep.value.items.map(item)
      const regexFallbackError = fffGrep.value.regexFallbackError

      remember(state, dir, input.pattern, Array.from(new Set(rows.map((row) => path.join(dir, row.path.text)))))

      return {
        items: rows,
        partial: false,
        hasNextPage: !!fffGrep.value.nextCursor,
        engine: "fff" as const,
        regexFallbackError,
      }
    })

    const glob: Interface["glob"] = Effect.fn("Search.glob")(function* (input) {
      input.signal?.throwIfAborted()

      const dir = FSUtil.resolve(input.cwd)
      const limit = input.limit ?? 100
      const pick = yield* picker(dir)

      if (pick) {
        const fffGlob = yield* fffSync("glob file search", () =>
          pick.glob(normalize(input.pattern), {
            pageIndex: 0,
            pageSize: limit,
          }),
        ).pipe(
          Effect.catch((error) => {
            log.warn("fff glob failed", { dir, pattern: input.pattern, error })
            return Effect.succeed<Fff.Result<Fff.Search> | undefined>(undefined)
          }),
        )

        if (fffGlob?.ok) {
          const rows: string[] = Array.from(new Set(fffGlob.value.items.map((item) => normalize(item.relativePath))))

          remember(
            state,
            dir,
            input.pattern,
            rows.map((row) => path.join(dir, row)),
          )

          return {
            files: rows.slice(0, limit).map((row) => path.join(dir, row)),
            truncated: fffGlob.value.totalMatched > rows.length,
          }
        } else if (fffGlob) {
          log.warn("fff glob failed", { dir, pattern: input.pattern, error: fffGlob.error })
          // fall through to the fallback
        }
      }

      const rows = yield* rg.files({ cwd: dir, glob: [input.pattern], signal: input.signal }).pipe(
        Stream.take(limit + 1),
        Stream.runCollect,
        Effect.map((chunk) => [...chunk]),
      )
      const truncated = rows.length > limit
      if (truncated) rows.length = limit

      const output = yield* Effect.forEach(
        rows,
        Effect.fnUntraced(function* (file) {
          const full = path.join(dir, file)
          const info = yield* fs.stat(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const time =
            info?.mtime.pipe(
              Option.map((item) => item.getTime()),
              Option.getOrElse(() => 0),
            ) ?? 0
          return { file: full, time }
        }),
        { concurrency: 16 },
      )
      output.sort((a, b) => b.time - a.time)
      return {
        files: output.map((item) => item.file),
        truncated,
      }
    })

    const open: Interface["open"] = Effect.fn("Search.open")(function* (input) {
      const file = input.cwd
        ? FSUtil.resolve(path.isAbsolute(input.file) ? input.file : path.join(input.cwd, input.file))
        : FSUtil.resolve(input.file)
      const idx = state.recent.findIndex((item) => item.files.includes(file))
      if (idx < 0) return

      const row = state.recent[idx]
      state.recent.splice(idx, 1)
      const entry = state.pick.get(row.dir)
      if (!entry) return

      const out = yield* fffSync("track query", () => entry.pick.trackQuery(row.text, file)).pipe(
        Effect.catch((error) => {
          log.warn("fff track query failed", { dir: row.dir, query: row.text, file, error })
          return Effect.succeed<Fff.Result<boolean> | undefined>(undefined)
        }),
      )
      if (!out) return
      if (!out.ok) log.warn("fff track query failed", { dir: row.dir, query: row.text, file, error: out.error })
    })

    return Service.of({ files, tree, search, file, glob, open, warm, release })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(Ripgrep.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export function tree(input: Ripgrep.TreeInput) {
  return runPromise((svc) => svc.tree(input))
}

export function search(input: Ripgrep.SearchInput) {
  return runPromise((svc) => svc.search(input))
}

export function file(input: FileInput) {
  return runPromise((svc) => svc.file(input))
}

export function glob(input: GlobInput) {
  return runPromise((svc) => svc.glob(input))
}

export function open(input: { cwd?: string; file: string }) {
  return runPromise((svc) => svc.open(input))
}

export * as Search from "./search"
