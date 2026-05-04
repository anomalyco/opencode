import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Glob } from "@opencode-ai/core/util/glob"
import { Clock, Context, Deferred, Effect, Layer, Option } from "effect"
import * as Stream from "effect/Stream"
import z from "zod"
import * as InstanceState from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Fff } from "#fff"
import { Ripgrep } from "./ripgrep"

const log = Log.create({ service: "file.search" })
const root = path.join(Global.Path.cache, "fff")

export const Match = z.object({
  path: z.object({
    text: z.string(),
  }),
  lines: z.object({
    text: z.string(),
  }),
  line_number: z.number(),
  absolute_offset: z.number(),
  submatches: z.array(
    z.object({
      match: z.object({
        text: z.string(),
      }),
      start: z.number(),
      end: z.number(),
    }),
  ),
})

export type Item = z.infer<typeof Match>

export interface Result {
  readonly items: Ripgrep.Item[]
  readonly partial: boolean
  readonly engine: "fff" | "ripgrep"
  readonly regexFallbackError?: string
}

export interface FileInput {
  readonly cwd: string
  readonly query: string
  readonly limit?: number
  readonly current?: string
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

interface State {
  readonly pick: Map<string, Fff.Picker>
  readonly wait: Map<string, Deferred.Deferred<Fff.Picker, Error>>
  readonly recent: Query[]
}

export interface Interface {
  readonly files: Ripgrep.Interface["files"]
  readonly tree: Ripgrep.Interface["tree"]
  readonly search: (input: Ripgrep.SearchInput) => Effect.Effect<Result, unknown>
  readonly file: (input: FileInput) => Effect.Effect<string[] | undefined, unknown>
  readonly glob: (input: GlobInput) => Effect.Effect<{ files: string[]; truncated: boolean }, unknown>
  readonly open: (input: { cwd?: string; file: string }) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Search") {}

function key(dir: string) {
  return Buffer.from(dir).toString("base64url")
}

function normalize(text: string) {
  return text.replaceAll("\\", "/")
}

function include(pattern: string) {
  const value = pattern.trim().replaceAll("\\", "/")
  if (!value) return "*"
  const flat = value.replaceAll("**/", "").replaceAll("/**", "/")
  const idx = flat.lastIndexOf("/")
  if (idx < 0) return flat
  const dir = flat.slice(0, idx + 1)
  const glob = flat.slice(idx + 1)
  if (!glob) return dir
  return `${dir} ${glob}`
}

// fff supports glob narrowing for any search out of the box
function fffGlobbedQuery(query: string, glob?: string | string[]) {
  if (query && glob) {
    let resolvedGlob = ""
    if (Array.isArray(glob)) {
      resolvedGlob = glob.join(" ")
    } else {
      resolvedGlob = glob
    }

    return `${glob} ${query}`
  }

  return query ?? glob
}

function remember(state: State, dir: string, text: string, files: string[]) {
  if (!files.length) return
  const next = Array.from(new Set(files.map(AppFileSystem.resolve))).slice(0, 64)
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

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Ripgrep.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const rg = yield* Ripgrep.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Search.state")(() =>
        Effect.gen(function* () {
          const next = {
            pick: new Map<string, Fff.Picker>(),
            wait: new Map<string, Deferred.Deferred<Fff.Picker, Error>>(),
            recent: [] as Query[],
          }
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              for (const pick of next.pick.values()) pick.destroy()
            }),
          )
          return next
        }),
      ),
    )

    const rip = Effect.fn("Search.rip")(function* (input: Ripgrep.SearchInput) {
      const out = yield* rg.search(input)
      return {
        items: out.items,
        partial: out.partial,
        engine: "ripgrep" as const,
      }
    })

    const picker = Effect.fn("Search.picker")(function* (cwd: string) {
      if (!Fff.available()) return undefined

      const dir = AppFileSystem.resolve(cwd)
      const current = yield* InstanceState.get(state)
      const existing = current.pick.get(dir)
      if (existing) return existing

      const pending = current.wait.get(dir)
      if (pending) return yield* Deferred.await(pending)

      const gate = yield* Deferred.make<Fff.Picker, Error>()
      current.wait.set(dir, gate)
      try {
        yield* fs.ensureDir(root)
        const id = key(dir)
        const made = yield* Effect.sync(() =>
          Fff.create({
            basePath: dir,
            frecencyDbPath: path.join(root, `${id}.frecency.mdb`),
            historyDbPath: path.join(root, `${id}.history.mdb`),
            aiMode: true,
          }),
        )
        if (!made.ok) {
          log.warn("fff init failed", { dir, error: made.error })
          const err = new Error(made.error)
          yield* Deferred.fail(gate, err)
          return yield* Effect.fail(err)
        }

        const pick = made.value

        const ready = yield* Effect.gen(function* () {
          const start = yield* Clock.currentTimeMillis
          while (true) {
            if (!pick.isScanning()) return true
            const now = yield* Clock.currentTimeMillis
            if (now - start >= 5_000) return false
            yield* Effect.sleep("25 millis")
          }
        })

        if (!ready) {
          pick.destroy()
          const err = new Error("fff scan timed out")
          log.warn("fff scan timed out", { dir })
          yield* Deferred.fail(gate, err)
          return yield* Effect.fail(err)
        }

        const git = yield* Effect.sync(() => pick.refreshGitStatus())
        if (!git.ok) log.warn("fff git refresh failed", { dir, error: git.error })

        current.pick.set(dir, pick)
        yield* Deferred.succeed(gate, pick)
        return pick
      } finally {
        if (current.wait.get(dir) === gate) current.wait.delete(dir)
      }
    })

    const files: Interface["files"] = (input) => rg.files(input)
    const tree: Interface["tree"] = (input) => rg.tree(input)

    const file: Interface["file"] = Effect.fn("Search.file")(function* (input) {
      const query = input.query.trim()
      if (!query) return []

      const pick = yield* picker(input.cwd).pipe(Effect.catch(() => Effect.succeed<Fff.Picker | undefined>(undefined)))
      if (!pick) return undefined

      const dir = AppFileSystem.resolve(input.cwd)
      const out = yield* Effect.sync(() =>
        pick.fileSearch(query, {
          pageIndex: 0,
          currentFile: input.current, // supports both relative and absolute (relative preferred)
          pageSize: Math.max(input.limit ?? 100, 100),
        }),
      )
      if (!out.ok) {
        log.warn("fff file search failed", { dir, query, error: out.error })
        return undefined
      }

      const rows: string[] = Array.from(
        new Set(
          out.value.items.flatMap((item, idx): string[] => {
            const score = out.value.scores[idx]
            if (!score || score.total <= 0) return []
            return [normalize(item.relativePath)]
          }),
        ),
      )
      const current = yield* InstanceState.get(state)
      remember(
        current,
        dir,
        query,
        rows.map((row) => path.join(dir, row)),
      )
      return rows.slice(0, input.limit ?? 100)
    })

    const search: Interface["search"] = Effect.fn("Search.search")(function* (input) {
      input.signal?.throwIfAborted()
      if (input.file?.length) return yield* rip(input)

      const pick = yield* picker(input.cwd).pipe(Effect.catch(() => Effect.succeed<Fff.Picker | undefined>(undefined)))
      if (!pick) return yield* rip(input)

      const dir = AppFileSystem.resolve(input.cwd)
      const rows: Item[] = []
      let cursor: Fff.Cursor = null
      let regexFallbackError: string | undefined

      while (input.limit === undefined || rows.length < input.limit) {
        input.signal?.throwIfAborted()
        const out = yield* Effect.sync(() =>
          pick.grep(fffGlobbedQuery(input.pattern, input.glob), {
            mode: "regex",
            cursor,
            maxMatchesPerFile: input.limit ?? 0,
            timeBudgetMs: 1_500,
          }),
        )
        if (!out.ok) {
          log.warn("fff grep failed", { dir, pattern: input.pattern, error: out.error })
          return yield* rip(input)
        }

        regexFallbackError = regexFallbackError ?? out.value.regexFallbackError
        for (const hit of out.value.items) {
          rows.push(item(hit))
          if (input.limit !== undefined && rows.length >= input.limit) break
        }

        if (!out.value.nextCursor) break
        cursor = out.value.nextCursor
      }

      if (!rows.length && input.glob?.length) return yield* rip(input)

      const current = yield* InstanceState.get(state)
      remember(current, dir, input.pattern, Array.from(new Set(rows.map((row) => path.join(dir, row.path.text)))))

      return {
        items: rows,
        partial: false,
        engine: "fff" as const,
        regexFallbackError,
      }
    })

    const glob: Interface["glob"] = Effect.fn("Search.glob")(function* (input) {
      input.signal?.throwIfAborted()

      const dir = AppFileSystem.resolve(input.cwd)
      const limit = input.limit ?? 100
      const pick = yield* picker(dir).pipe(Effect.catch(() => Effect.succeed<Fff.Picker | undefined>(undefined)))

      if (pick) {
        const out = yield* Effect.sync(() =>
          pick.fileSearch(include(input.pattern), {
            pageIndex: 0,
            pageSize: Math.max(limit * 4, 200),
          }),
        )

        if (out.ok) {
          const rows: string[] = out.value.items.map((item) => item.relativePath)

          if (rows.length > 0) {
            const current = yield* InstanceState.get(state)
            remember(
              current,
              dir,
              input.pattern,
              rows.map((row) => path.join(dir, row)),
            )

            return {
              files: rows.slice(0, limit).map((row) => path.join(dir, row)),
              truncated: rows.length > limit,
            }
          }
        } else {
          log.warn("fff glob failed", { dir, pattern: input.pattern, error: out.error })
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
      const current = yield* InstanceState.get(state)
      const file = input.cwd
        ? AppFileSystem.resolve(path.isAbsolute(input.file) ? input.file : path.join(input.cwd, input.file))
        : AppFileSystem.resolve(input.file)
      const idx = current.recent.findIndex((item) => item.files.includes(file))
      if (idx < 0) return

      const row = current.recent[idx]
      current.recent.splice(idx, 1)
      const pick = current.pick.get(row.dir)
      if (!pick) return

      const out = yield* Effect.sync(() => pick.trackQuery(row.text, file))
      if (!out.ok) log.warn("fff track query failed", { dir: row.dir, query: row.text, file, error: out.error })
    })

    return Service.of({ files, tree, search, file, glob, open })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(Ripgrep.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
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
