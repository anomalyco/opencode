// Workspace — substrate-agnostic tool-facing surface.
//
//   Primitives.Service  — L4-internal. Consumed by Format / LSP / FileTime
//                         / Snapshot / Instruction / File / FileWatcher.
//   Service.Tag         — L5-facing. Wraps Primitives with post-write
//                         orchestration; returns {diagnostics} from writeFile.

import { Context, Effect, Layer, Stream } from "effect"
import path from "node:path"
import type { Scope } from "effect/Scope"
import type { Workspace as WorkspaceTypes } from "./types"
import { WorkspaceError as WorkspaceErrorCls } from "./workspace-error"
import { WorkspaceRouter } from "./router"
import { sliceLines, type LinesView as LinesViewHelper } from "./helpers/lines"
import { isBinaryBytes } from "./helpers/is-binary"
import { parseRgJsonLine, rgArgs, type RgHit } from "./helpers/ripgrep"
import { WorkspaceBus, WorkspaceFormat, WorkspaceLsp } from "./internal-services"

export namespace Workspace {
  // ------------- re-exports of the Backend-level types -------------

  export type FileInfo = WorkspaceTypes.FileInfo
  export type DirEntry = WorkspaceTypes.DirEntry
  export type FsEvent = WorkspaceTypes.FsEvent
  export type ExecOpts = WorkspaceTypes.ExecOpts
  export type ExecResult = WorkspaceTypes.ExecResult
  export type ExecStreamHandle = WorkspaceTypes.ExecStreamHandle
  export type WatchOpts = WorkspaceTypes.WatchOpts

  // ------------- Primitives-level types -------------

  // Re-export the pure LinesView shape. Aliased to dodge a TS circular
  // alias error (top-level `import { LinesView }` + `export LinesView`
  // inside a namespace with the same name is illegal).
  export interface LinesView extends Readonly<LinesViewHelper> {}
  export interface LinesOpts {
    readonly offset: number
    readonly limit: number
  }

  export interface SearchHit {
    readonly path: string
    readonly lineNumber: number
    readonly lineText: string
    readonly absoluteOffset: number
    readonly submatches: ReadonlyArray<{
      readonly match: string
      readonly start: number
      readonly end: number
    }>
  }

  export interface SearchResult {
    readonly items: ReadonlyArray<SearchHit>
    readonly partial: boolean
  }

  export interface SearchOpts {
    readonly cwd?: string
    readonly pattern: string
    readonly glob?: ReadonlyArray<string>
    readonly limit?: number
    readonly follow?: boolean
    readonly file?: ReadonlyArray<string>
  }

  export interface FilesOpts {
    readonly cwd?: string
    readonly glob?: ReadonlyArray<string>
    readonly hidden?: boolean
    readonly follow?: boolean
    readonly maxDepth?: number
  }

  // Re-export the error class under the namespace so L4/L5 code can
  // refer to `Workspace.WorkspaceError`. Aliased to dodge TS's ban on
  // export-declarations inside a namespace.
  export const WorkspaceError = WorkspaceErrorCls
  export type WorkspaceError = WorkspaceErrorCls

  // ------------- Primitives -------------

  export namespace Primitives {
    export interface Interface {
      readonly rootPath: Effect.Effect<string, WorkspaceError>
      /**
       * Absolute path to the backend's preferred shell interpreter.
       * Bash-tool callers should pass this to `execStream` instead of
       * querying `process.env.SHELL` so that cross-substrate flows
       * (macOS host → Linux sandbox) don't try to spawn a shell the
       * backend's image doesn't provide.
       */
      readonly shell: Effect.Effect<string, WorkspaceError>
      readonly stat: (p: string) => Effect.Effect<FileInfo, WorkspaceError>
      readonly exists: (p: string) => Effect.Effect<boolean, WorkspaceError>
      readonly readFile: (p: string) => Effect.Effect<Uint8Array, WorkspaceError>
      readonly readFileString: (p: string) => Effect.Effect<string, WorkspaceError>
      /** Raw write — does NOT create parents. Use writeFileWithDirs for that. */
      readonly writeFile: (p: string, data: Uint8Array | string) => Effect.Effect<void, WorkspaceError>
      readonly mkDir: (p: string, opts?: { recursive?: boolean }) => Effect.Effect<void, WorkspaceError>
      readonly readDir: (p: string) => Effect.Effect<DirEntry[], WorkspaceError>
      readonly remove: (p: string, opts?: { recursive?: boolean }) => Effect.Effect<void, WorkspaceError>
      readonly rename: (from: string, to: string) => Effect.Effect<void, WorkspaceError>

      readonly writeFileWithDirs: (p: string, data: Uint8Array | string) => Effect.Effect<void, WorkspaceError>
      readonly readFileLines: (p: string, opts: LinesOpts) => Effect.Effect<LinesView, WorkspaceError>
      readonly isBinary: (p: string, sizeBytes: number) => Effect.Effect<boolean, WorkspaceError>
      readonly isDir: (p: string) => Effect.Effect<boolean, WorkspaceError>

      readonly exec: (cmd: string, args: string[], opts?: ExecOpts) => Effect.Effect<ExecResult, WorkspaceError>
      readonly execStream: (
        cmd: string,
        args: string[],
        opts?: ExecOpts,
      ) => Effect.Effect<ExecStreamHandle, WorkspaceError, Scope>

      readonly search: (input: SearchOpts) => Effect.Effect<SearchResult, WorkspaceError>
      readonly files: (input: FilesOpts) => Stream.Stream<string, WorkspaceError>

      readonly watch: (p: string, opts?: WatchOpts) => Stream.Stream<FsEvent, WorkspaceError>

      readonly resolve: (pathOrRelative: string) => Effect.Effect<string, WorkspaceError>
      readonly containsPath: (absolutePath: string) => Effect.Effect<boolean, WorkspaceError>
    }

    export class Service extends Context.Service<Service, Interface>()("@opencode/WorkspacePrimitives") {}

    // Internal helper — map a BackendError (or any thrown value) into
    // a WorkspaceError so consumers see the Workspace-level error shape.
    const wrapError = (method: string, p?: string) => (cause: unknown) =>
      new WorkspaceError({
        method,
        path: p,
        cause: cause instanceof Error ? cause : new Error(String(cause)),
      })

    export const layer: Layer.Layer<Service, never, WorkspaceRouter.Service> = Layer.effect(
      Service,
      Effect.gen(function* () {
        const router = yield* WorkspaceRouter.Service

        // All primitive calls go through `withBackend` so a router
        // failure (misconfigured tenant) fails the specific call with a
        // WorkspaceError rather than crashing the layer.
        const withBackend = <A>(
          method: string,
          p: string | undefined,
          fn: (b: WorkspaceTypes.Backend) => Effect.Effect<A, unknown>,
        ): Effect.Effect<A, WorkspaceError> =>
          router.backend.pipe(
            Effect.flatMap((b) => fn(b).pipe(Effect.mapError(wrapError(method, p)))),
          )

        const withBackendScoped = <A>(
          method: string,
          p: string | undefined,
          fn: (b: WorkspaceTypes.Backend) => Effect.Effect<A, unknown, Scope>,
        ): Effect.Effect<A, WorkspaceError, Scope> =>
          router.backend.pipe(
            Effect.flatMap((b) => fn(b).pipe(Effect.mapError(wrapError(method, p)))),
          ) as Effect.Effect<A, WorkspaceError, Scope>

        const withBackendStream = <A>(
          method: string,
          p: string | undefined,
          fn: (b: WorkspaceTypes.Backend) => Stream.Stream<A, unknown>,
        ): Stream.Stream<A, WorkspaceError> =>
          Stream.unwrap(
            router.backend.pipe(
              Effect.map((b) => fn(b).pipe(Stream.mapError(wrapError(method, p)))),
            ),
          ) as Stream.Stream<A, WorkspaceError>

        // ---- basic forwards ----

        const rootPath: Interface["rootPath"] = router.backend.pipe(
          Effect.map((b) => b.rootPath),
          Effect.mapError((err) =>
            err instanceof WorkspaceError ? err : wrapError("rootPath")(err),
          ),
        )

        const shell: Interface["shell"] = router.backend.pipe(
          Effect.map((b) => b.shell),
          Effect.mapError((err) =>
            err instanceof WorkspaceError ? err : wrapError("shell")(err),
          ),
        )

        const stat: Interface["stat"] = (p) => withBackend("stat", p, (b) => b.stat(p))
        const exists: Interface["exists"] = (p) => withBackend("exists", p, (b) => b.exists(p))
        const readFile: Interface["readFile"] = (p) => withBackend("readFile", p, (b) => b.readFile(p))

        const readFileString: Interface["readFileString"] = (p) =>
          readFile(p).pipe(Effect.map((bytes) => new TextDecoder("utf8").decode(bytes)))

        const encodeMaybe = (data: Uint8Array | string): Uint8Array =>
          typeof data === "string" ? new TextEncoder().encode(data) : data

        const writeFile: Interface["writeFile"] = (p, data) =>
          withBackend("writeFile", p, (b) => b.writeFile(p, encodeMaybe(data)))

        const mkDir: Interface["mkDir"] = (p, opts) =>
          withBackend("mkDir", p, (b) => b.mkDir(p, { recursive: opts?.recursive ?? false }))

        const readDir: Interface["readDir"] = (p) => withBackend("readDir", p, (b) => b.readDir(p))

        const remove: Interface["remove"] = (p, opts) =>
          withBackend("remove", p, (b) => b.remove(p, { recursive: opts?.recursive ?? false }))

        const rename: Interface["rename"] = (from, to) =>
          withBackend("rename", from, (b) => b.rename(from, to))

        // writeFileWithDirs = ensure parent chain then raw writeFile. We
        // compute the parent via posix.dirname — every Backend rootPath
        // is POSIX-shaped for v2 tenants.
        const writeFileWithDirs: Interface["writeFileWithDirs"] = (p, data) =>
          Effect.gen(function* () {
            const parent = path.posix.dirname(p)
            if (parent && parent !== "." && parent !== "/") {
              yield* mkDir(parent, { recursive: true })
            }
            yield* writeFile(p, data)
          })

        // readFileLines = readFile + pure sliceLines.
        const readFileLines: Interface["readFileLines"] = (p, opts) =>
          readFile(p).pipe(Effect.map((bytes) => sliceLines(bytes, opts)))

        // isBinary: stat-size threshold + small read + helper. sizeBytes
        // is a hint from the caller so we can short-circuit huge files.
        const isBinary: Interface["isBinary"] = (p, _sizeBytes) => {
          const ext = path.extname(p).toLowerCase()
          // Known-binary extensions short-circuit without reading.
          if (isBinaryBytes(ext, new Uint8Array(0))) return Effect.succeed(true)
          // Otherwise read the file (helper samples first 4 KB).
          return readFile(p).pipe(Effect.map((bytes) => isBinaryBytes(ext, bytes)))
        }

        const isDir: Interface["isDir"] = (p) =>
          stat(p).pipe(
            Effect.map((info) => info.type === "directory"),
            Effect.catch(() => Effect.succeed(false)),
          )

        // ---- exec ----

        const exec: Interface["exec"] = (cmd, args, opts) =>
          withBackend("exec", undefined, (b) => b.exec(cmd, args, opts))

        const execStream: Interface["execStream"] = (cmd, args, opts) =>
          withBackendScoped("execStream", undefined, (b) => b.execStream(cmd, args, opts))

        // search / files shell out to `rg` via Backend.exec so the
        // command runs in the tenant substrate. If `rg` is missing we
        // fail with a WorkspaceError rather than leaking the spawn shape.

        const search: Interface["search"] = (input) =>
          Effect.gen(function* () {
            const b = yield* router.backend
            const cwd = input.cwd ?? b.rootPath
            const argv = rgArgs({
              mode: "search",
              glob: input.glob ? [...input.glob] : undefined,
              follow: input.follow,
              limit: input.limit,
              pattern: input.pattern,
              file: input.file ? [...input.file] : undefined,
            })
            const result = yield* b
              .exec("rg", argv, { cwd })
              .pipe(Effect.mapError(wrapError("search", cwd)))
            // rg exit codes: 0 match, 1 no-match, 2 partial/io error.
            // Accept 0/1/2 per upstream Ripgrep.search.
            if (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== 2) {
              return yield* Effect.fail(
                new WorkspaceError({
                  method: "search",
                  cause: new Error(`rg failed exit=${result.exitCode}: ${result.stderr}`),
                }),
              )
            }
            const items: SearchHit[] = []
            for (const line of result.stdout.split("\n")) {
              const hit: RgHit | null = parseRgJsonLine(line)
              if (!hit) continue
              items.push({
                path: hit.path.text,
                lineNumber: hit.line_number,
                lineText: hit.lines.text,
                absoluteOffset: hit.absolute_offset,
                submatches: hit.submatches.map((sm) => ({
                  match: sm.match.text,
                  start: sm.start,
                  end: sm.end,
                })),
              })
            }
            const partial = result.exitCode === 2
            return { items, partial } as SearchResult
          })

        const files: Interface["files"] = (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const b = yield* router.backend
              const cwd = input.cwd ?? b.rootPath
              const argv = rgArgs({
                mode: "files",
                glob: input.glob ? [...input.glob] : undefined,
                hidden: input.hidden,
                follow: input.follow,
                maxDepth: input.maxDepth,
              })
              // exec then split — avoids needing streaming stdout from
              // the backend for a first-cut implementation.
              const result = yield* b
                .exec("rg", argv, { cwd })
                .pipe(Effect.mapError(wrapError("files", cwd)))
              if (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== 2) {
                return Stream.fail(
                  new WorkspaceError({
                    method: "files",
                    cause: new Error(`rg failed exit=${result.exitCode}: ${result.stderr}`),
                  }),
                ) as Stream.Stream<string, WorkspaceError>
              }
              const lines = result.stdout.split("\n").filter((l) => l.length > 0)
              return Stream.fromIterable(lines) as Stream.Stream<string, WorkspaceError>
            }),
          )

        const watch: Interface["watch"] = (p, opts) => withBackendStream("watch", p, (b) => b.watch(p, opts))

        // ---- resolve / containsPath ----
        //
        // resolve turns a relative path (or an absolute one already
        // inside the workspace) into an absolute posix path under
        // rootPath. This is purely a string operation — no realpath
        // (that would require a backend round-trip and would leak host
        // semantics into the remote sandbox).
        const resolve: Interface["resolve"] = (pathOrRelative) =>
          router.backend.pipe(
            Effect.mapError((err) => (err instanceof WorkspaceError ? err : wrapError("resolve")(err))),
            Effect.map((b) => {
              if (path.posix.isAbsolute(pathOrRelative)) return pathOrRelative
              return path.posix.join(b.rootPath, pathOrRelative)
            }),
          )

        const containsPath: Interface["containsPath"] = (absolutePath) =>
          router.backend.pipe(
            Effect.mapError((err) => (err instanceof WorkspaceError ? err : wrapError("containsPath")(err))),
            Effect.map((b) => {
              if (!path.posix.isAbsolute(absolutePath)) return false
              const rel = path.posix.relative(b.rootPath, absolutePath)
              return rel === "" || (!rel.startsWith("..") && !path.posix.isAbsolute(rel))
            }),
          )

        return Service.of({
          rootPath,
          shell,
          stat,
          exists,
          readFile,
          readFileString,
          writeFile,
          mkDir,
          readDir,
          remove,
          rename,
          writeFileWithDirs,
          readFileLines,
          isBinary,
          isDir,
          exec,
          execStream,
          search,
          files,
          watch,
          resolve,
          containsPath,
        })
      }),
    )

    export const defaultLayer: Layer.Layer<Service, never, never> = layer.pipe(
      Layer.provide(WorkspaceRouter.defaultLayer),
    )
  }

  // ------------- Service (tool-facing wrapper) -------------

  export namespace Service {
    export interface WriteResult {
      readonly diagnostics: Record<string, unknown[]>
    }

    export interface Interface extends Omit<Primitives.Interface, "writeFile" | "writeFileWithDirs"> {
      readonly writeFile: (p: string, data: Uint8Array | string) => Effect.Effect<WriteResult, WorkspaceError>
      readonly writeFileWithDirs: (p: string, data: Uint8Array | string) => Effect.Effect<WriteResult, WorkspaceError>
    }

    export class Tag extends Context.Service<Tag, Interface>()("@opencode/WorkspaceService") {}

    export const layer: Layer.Layer<
      Tag,
      never,
      Primitives.Service | WorkspaceFormat.Service | WorkspaceBus.Service | WorkspaceLsp.Service
    > = Layer.effect(
      Tag,
      Effect.gen(function* () {
        const primitives = yield* Primitives.Service
        const format = yield* WorkspaceFormat.Service
        const bus = yield* WorkspaceBus.Service
        const lsp = yield* WorkspaceLsp.Service

        // Shared post-write orchestration: format, publish events,
        // re-open in LSP, collect diagnostics. With null providers
        // this reduces to {diagnostics: {}}.
        const orchestrate = (p: string): Effect.Effect<WriteResult, WorkspaceError> =>
          Effect.gen(function* () {
            yield* format.file(p).pipe(Effect.catch(() => Effect.void))
            yield* bus.fileEdited(p)
            yield* bus.fileWatcherUpdated(p, "change")
            yield* lsp.touchFile(p, true).pipe(Effect.catch(() => Effect.void))
            const diagnostics = yield* lsp
              .diagnostics()
              .pipe(Effect.catch(() => Effect.succeed({} as Record<string, unknown[]>)))
            return { diagnostics }
          })

        const writeFile: Interface["writeFile"] = (p: string, data: Uint8Array | string) =>
          primitives.writeFile(p, data).pipe(Effect.flatMap(() => orchestrate(p)))

        const writeFileWithDirs: Interface["writeFileWithDirs"] = (p: string, data: Uint8Array | string) =>
          primitives.writeFileWithDirs(p, data).pipe(Effect.flatMap(() => orchestrate(p)))

        return Tag.of({
          rootPath: primitives.rootPath,
          shell: primitives.shell,
          stat: primitives.stat,
          exists: primitives.exists,
          readFile: primitives.readFile,
          readFileString: primitives.readFileString,
          writeFile,
          mkDir: primitives.mkDir,
          readDir: primitives.readDir,
          remove: primitives.remove,
          rename: primitives.rename,
          writeFileWithDirs,
          readFileLines: primitives.readFileLines,
          isBinary: primitives.isBinary,
          isDir: primitives.isDir,
          exec: primitives.exec,
          execStream: primitives.execStream,
          search: primitives.search,
          files: primitives.files,
          watch: primitives.watch,
          resolve: primitives.resolve,
          containsPath: primitives.containsPath,
        })
      }),
    )

    // defaultLayer lives in ./runtime.ts to avoid a module-eval cycle:
    // Format/LSP/Bus/File/FileWatcher statically import this file.
  }
}
