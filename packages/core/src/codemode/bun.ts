export * as CodeModeBun from "./bun.js"

import { Extension } from "@opencode/codemode"
import { Glob } from "@opencode/util/glob"
import { isUtf8 } from "buffer"
import { Context, Effect, Option } from "effect"
import { constants } from "os"
import path from "path"
import { fileURLToPath } from "url"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { FileMutation } from "../file-mutation.js"
import { FileWrite } from "../file-write.js"
import { Permission } from "../permission.js"
import { fileDiff } from "../tool/plugin/file-diff.js"
import { CodeModeDiffs } from "./diffs.js"
import { CodeModeExecution } from "./execution.js"

/** The session's file services, which the `Bun` global reads and writes through. */
export type Services = FileAccess.Service | FileWrite.Service | FileMutation.Service

type Host = {
  readonly context: FileAccess.Invocation
  readonly access: FileAccess.Interface
  readonly fileWrite: FileWrite.Interface
  readonly fileMutation: FileMutation.Interface
  readonly permission: Permission.Interface
}
type Range = { readonly offset: number; readonly length: number }

// What a BunFile names: the path as the program wrote it, where it resolved to when `Bun.file` asked to read it, and
// the part of the file a slice covers.
type Handle = { readonly name: string; readonly target: FileAccess.Target; readonly range?: Range }

// A BunFile reaches a program as a copy and comes back as another, but its functions come back as themselves: its
// `bytes` function says which file a value passed to `Bun.write` or `fetch` is, and its type.
const handles = new WeakMap<Function, Handle & { readonly type: string }>()

// A run gets `Bun` only with the session's file services (see `CodeModeTool.create`).
const service = <I, S>(key: Context.Key<I, S>) =>
  Effect.flatMap(Effect.serviceOption(key), (found) =>
    Option.isSome(found) ? Effect.succeed(found.value) : Effect.die("Code Mode Bun needs the session's file services."),
  )

// One file operation, acting for the execute call as a tool does. A permission error reaches the program as core
// reports it; any other failure carries Node's `code`, `syscall` and `path`, so `e.code === "ENOENT"` works.
const call = <A, E>(syscall: string, name: string, body: (host: Host) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* body({
      context: yield* CodeModeExecution.Service,
      access: yield* service(FileAccess.Service),
      fileWrite: yield* service(FileWrite.Service),
      fileMutation: yield* service(FileMutation.Service),
      permission: yield* Permission.Service,
    })
  }).pipe(Effect.mapError((error) => nodeError(error, syscall, name)))

// `Bun.file` asks read permission, and external-directory approval outside the project, once: the file's own reads
// don't ask again, and its writes ask only edit. Bun reads `size` and `lastModified` when a program asks for them. A
// program's copy of the file can't ask later, so they are read here. A missing file has Bun's values for one.
const open = (input: string | URL, options?: { readonly type?: string }) => {
  supports("Bun.file", options, ["type"])
  const name = toPath(input)
  return call("stat", name, (host) =>
    Effect.gen(function* () {
      const target = yield* host.access.authorizeRead(name, host.context)
      const info = yield* followed(target.environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () => Effect.undefined),
      )
      return file(
        { name, target },
        options?.type ?? mime(name),
        info?.size ?? 0,
        Math.trunc(info?.mtimeMs ?? 2 ** 52 - 1),
      )
    }),
  )
}

// A BunFile's own asynchronous function. A function inside a result is called synchronously, and would make the
// program wait for its Effect and throw its failure. Handing the Effect back still pending gives the program a
// promise instead, which a failure rejects.
const later =
  <Args extends ReadonlyArray<unknown>, A, E, R>(run: (...args: Args) => Effect.Effect<A, E, R>) =>
  (...args: Args) =>
    Effect.succeed(run(...args))

// The part of Bun's BunFile that is implemented.
const file = (handle: Handle, type: string, size: number, lastModified: number) => {
  const bytes = later(() => read(handle))
  handles.set(bytes, { ...handle, type })
  const unlink = later(() => remove(handle))
  // As Blob.slice: a negative index counts from the end, and a string in any position is the new type.
  const index = (value: number | string | undefined, fallback: number) => {
    if (typeof value !== "number") return fallback
    return value < 0 ? Math.max(size + value, 0) : Math.min(value, size)
  }
  return {
    name: handle.name,
    type,
    size,
    lastModified,
    text: later(() => read(handle).pipe(Effect.map(decode))),
    // The program catches the SyntaxError JSON.parse throws, as it would from Bun.
    json: later(() =>
      read(handle).pipe(
        Effect.flatMap((bytes) =>
          Effect.try({ try: (): unknown => JSON.parse(decode(bytes)), catch: (error) => error }),
        ),
      ),
    ),
    bytes,
    // The runtime has no ArrayBuffer: one crosses to a program as a Uint8Array.
    arrayBuffer: later(() => read(handle)),
    exists: later(() => exists(handle)),
    stat: later(() => stat(handle)),
    slice: (...args: ReadonlyArray<number | string | undefined>): unknown => {
      const start = index(args[0], 0)
      const length = Math.max(index(args[1], size) - start, 0)
      return file(
        { ...handle, range: { offset: (handle.range?.offset ?? 0) + start, length } },
        args.find((item) => typeof item === "string") ?? type,
        length,
        lastModified,
      )
    },
    write: later((data: unknown) => write(handle, data)),
    delete: unlink,
    unlink,
    writer: (options?: { readonly highWaterMark?: number }) => writer(handle, options),
  }
}

const read = (handle: Handle) =>
  call("open", handle.name, () =>
    Effect.map(
      handle.target.environment.files.read(handle.target.absolute, handle.range),
      // A plain Uint8Array over the same memory: a driver may give a Buffer, which Bun's `bytes()` never does.
      (result) => new Uint8Array(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength),
    ),
  )

// As in Bun, only a file exists: a directory doesn't.
const exists = (handle: Handle) =>
  call("access", handle.name, () =>
    Environment.typeFollowing(handle.target.environment.files, handle.target.absolute).pipe(
      Effect.map((type) => type === "file"),
      Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
    ),
  )

// The part of Node's Stats that the file's environment can tell.
const stat = (handle: Handle) =>
  call("stat", handle.name, () =>
    Effect.map(followed(handle.target.environment.files, handle.target.absolute), (info) => ({
      size: info.size,
      mtimeMs: info.mtimeMs,
      mtime: new Date(info.mtimeMs),
      isFile: () => info.type === "file",
      isDirectory: () => info.type === "directory",
      isSymbolicLink: () => info.type === "symlink",
    })),
  )

// What a path leads to, through a symlink: reading zero bytes resolves one. A directory behind a link keeps the
// link's own size.
const followed = (files: Environment.Files, absolute: string) =>
  Effect.flatMap(files.stat(absolute), (own) =>
    own.type !== "symlink"
      ? Effect.succeed(own)
      : files.read(absolute, { offset: 0, length: 0 }).pipe(
          Effect.map((result) => result.info),
          Effect.catchTag("Environment.WrongKind", (error) => Effect.succeed({ ...own, type: error.actual })),
        ),
  )

// As in Bun, `delete` removes a file, never a directory. It holds the file's mutation lock, as a patch that deletes
// a file does.
const remove = (handle: Handle) =>
  call("unlink", handle.name, (host) =>
    Effect.gen(function* () {
      const info = yield* handle.target.environment.files.stat(handle.target.absolute)
      if (info.type === "directory")
        return yield* new Environment.WrongKind({ path: handle.target.absolute, actual: info.type })
      yield* host.fileWrite.authorize(handle.target, host.context)
      yield* handle.target.environment.files.remove(handle.target.absolute)
      // Removing a file builds no diff, so the change is recorded without counts.
      yield* CodeModeDiffs.record({ file: handle.target.resource, status: "deleted" })
    }).pipe(host.fileMutation.withLock([handle.target])),
  )

// `Bun.write`: the bytes written. The destination is a path or a BunFile; the data is text, bytes, a BunFile to copy,
// or a response, whose body is read here. Like Bun, it creates missing parent directories unless `createPath` is false.
const writeTo = (destination: unknown, data: unknown, options?: { readonly createPath?: boolean }) => {
  supports("Bun.write", options, ["createPath"])
  const to = typeof destination === "string" || destination instanceof URL ? toPath(destination) : handleOf(destination)
  if (to === undefined) throw new TypeError("Bun.write expects a path or a BunFile to write to.")
  return write(to, data, options?.createPath !== false)
}

const write = (to: string | Handle, data: unknown, parents = true) => {
  const from = handleOf(data)
  // A copy asks edit without a diff of the file.
  return (from ? read(from) : contents(data)).pipe(
    Effect.flatMap((bytes) => put(to, bytes, { parents, diff: from === undefined })),
  )
}

// Writes exactly these bytes, with no formatting and no BOM handling, after asking edit permission. The request shows
// the change as a diff when both sides are text, like the write tool's. An append never reads the file: its diff
// shows only what it adds. Like an edit, it holds the file's mutation lock from reading the file to writing it, and
// writes through `FileMutation`.
const put = (
  to: string | Handle,
  bytes: Uint8Array,
  options: { readonly parents?: boolean; readonly diff?: boolean; readonly append?: boolean },
) =>
  call("open", typeof to === "string" ? to : to.name, (host) =>
    Effect.gen(function* () {
      const target = typeof to === "string" ? yield* host.fileWrite.target(to, host.context) : to.target
      return yield* Effect.gen(function* () {
        const type = yield* typeOf(target.environment.files, target.absolute)
        if (type === "directory") return yield* new Environment.WrongKind({ path: target.absolute, actual: type })
        if (
          type === undefined &&
          !options.parents &&
          (yield* typeOf(target.environment.files, path.dirname(target.absolute))) === undefined
        )
          return yield* new Environment.NotFound({ path: target.absolute })
        const after = options.diff ? text(bytes) : undefined
        const before =
          after === undefined || options.append || type === undefined
            ? ""
            : text((yield* target.environment.files.read(target.absolute)).bytes)
        const status = type === undefined ? "added" : "modified"
        const preview =
          after !== undefined && before !== undefined ? fileDiff(target.resource, before, after, status) : undefined
        yield* host.fileWrite.authorize(target, host.context, preview)
        yield* options.append
          ? host.fileMutation.append({ target, content: bytes })
          : host.fileMutation.write({ target, content: bytes })
        // The run's record reuses the request's diff. An append's diff starts at an empty file, so only its counts hold.
        yield* options.append
          ? CodeModeDiffs.appended(target, status, after)
          : CodeModeDiffs.written(target, status, preview)
        return bytes.byteLength
      }).pipe(host.fileMutation.withLock([target]))
    }),
  )

const typeOf = (files: Environment.Files, absolute: string) =>
  files.stat(absolute).pipe(
    Effect.map((info) => info.type),
    Effect.catchTag("Environment.NotFound", () => Effect.undefined),
  )

// Bytes as text when they are valid UTF-8.
const text = (bytes: Uint8Array) =>
  isUtf8(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString() : undefined

/** A BunFile given as a `fetch` body, read to a Blob of its type, which Bun sends as the Content-Type. Any other value is left as it is. */
export const body = <A>(value: A) => {
  const from = handleOf(value)
  if (!from) return Effect.succeed(value)
  return Effect.map(read(from), (bytes) => new Blob([new Uint8Array(bytes)], { type: from.type }))
}

const handleOf = (value: unknown) => {
  const bytes = method(value, "bytes")
  return bytes && handles.get(bytes)
}

// Only a host function crosses back from a program, so a `bytes`, `arrayBuffer` or `text` function here is one a host
// value came with, such as a `fetch` response's.
const contents = (data: unknown) => {
  const given = toBytes(data)
  if (given) return Effect.succeed(given)
  const body = method(data, "bytes") ?? method(data, "arrayBuffer") ?? method(data, "text")
  if (!body) return Effect.fail(unwritable())
  return Effect.tryPromise({ try: async (): Promise<unknown> => body(), catch: (error) => error }).pipe(
    Effect.flatMap((result) => {
      const bytes = toBytes(result)
      return bytes ? Effect.succeed(bytes) : Effect.fail(unwritable())
    }),
  )
}

const unwritable = () =>
  new TypeError("Bun.write expects a string, a Uint8Array, a BunFile, or a Response as the data to write.")

// A value from a program is a plain copy, so its functions are among its own entries.
const method = (value: unknown, key: string) => {
  if (typeof value !== "object" || value === null) return undefined
  const found: unknown = Object.entries(value).find(([name]) => name === key)?.[1]
  return typeof found === "function" ? found : undefined
}

// Like Bun, a number or a boolean is written as its text.
const toBytes = (value: unknown) => {
  if (typeof value === "string") return Buffer.from(value)
  if (typeof value === "number" || typeof value === "boolean") return Buffer.from(String(value))
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
}

// As `text()` does in Bun: UTF-8 without a leading byte order mark.
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// A subset of Bun's FileSink. Chunks collect here until a flush: the first replaces the file and later ones append to
// it, so a long write asks edit once per flush, with what that flush adds, not once per chunk. Bun's own sink writes
// over the start of an existing file without truncating it; this one replaces the file. As in Bun, a missing parent
// directory fails the flush.
const writer = (handle: Handle, options?: { readonly highWaterMark?: number }) => {
  supports("A file writer", options, ["highWaterMark"])
  const chunks: Array<Uint8Array> = []
  let buffered = 0
  let started = false
  const flush = () =>
    Effect.suspend(() => {
      if (chunks.length === 0) return Effect.succeed(0)
      return put(handle, Buffer.concat(chunks), { diff: true, append: started }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            started = true
            chunks.length = 0
            buffered = 0
          }),
        ),
      )
    })
  return {
    write: (chunk: unknown) => {
      const bytes = typeof chunk === "string" || chunk instanceof Uint8Array ? toBytes(chunk) : undefined
      if (!bytes) throw new TypeError("A file writer takes a string or a Uint8Array.")
      chunks.push(bytes)
      buffered += bytes.byteLength
      return buffered < (options?.highWaterMark ?? Infinity) ? bytes.byteLength : Effect.as(flush(), bytes.byteLength)
    },
    flush,
    end: flush,
  }
}

type ScanOptions = {
  readonly cwd?: string
  readonly dot?: boolean
  readonly absolute?: boolean
  readonly onlyFiles?: boolean
}

// `scan` and `scanSync` both give an array, which `for` and `for await` both take. As in Bun without `followSymlinks`, a symlink is neither a file nor a directory to
// look inside: only `onlyFiles: false` lists one.
const scan = (pattern: string, input?: string | ScanOptions) => {
  const options = typeof input === "string" ? { cwd: input } : input
  supports("A Bun.Glob scan", options, ["cwd", "dot", "absolute", "onlyFiles"])
  const cwd = options?.cwd ?? "."
  return call("scandir", cwd, (host) =>
    Effect.gen(function* () {
      const entries = (yield* glob(host, pattern, cwd, options?.dot === true)).filter(
        (entry) => options?.onlyFiles === false || entry.type === "file",
      )
      if (options?.absolute !== true) return entries.map((entry) => entry.path)
      const root = (yield* host.access.resolve({ path: cwd })).absolute
      return entries.map((entry) => path.resolve(root, entry.path))
    }),
  )
}

// The entries under `cwd` that a pattern matches, each by its path as the pattern names it, without a leading `./`.
const glob = (host: Host, given: string, cwd: string, dot: boolean) =>
  Effect.gen(function* () {
    const pattern = given.replace(/^(\.\/)+/, "")
    const segments = pattern.split("/")
    const wild = segments.findIndex((segment) => /[*?[\]{}()!+@]/.test(segment))
    // The fixed part of the pattern is where listing starts. An absolute pattern keeps its root and gives absolute
    // paths. Bun scans are filesystem reads, independent of the glob tool's permission. Ask read permission for
    // the listing root, and external-directory approval where it lists outside the project.
    const fixed = (wild < 0 ? segments : segments.slice(0, wild)).join("/") || (path.isAbsolute(pattern) ? "/" : ".")
    const base = path.isAbsolute(pattern) ? fixed : path.join(cwd, fixed)
    const target = yield* host.access.resolve({ path: base, kind: "directory" })
    yield* host.access.authorizeExternal([target], host.context)
    yield* host.permission.assert({
      action: "read",
      resources: [target.resource],
      save: [FileAccess.always(target)],
      metadata: { root: cwd },
      ...Permission.invocation(host.context),
    })
    const root = target.absolute
    if (wild < 0) {
      const type = yield* typeOf(target.environment.files, root)
      return type === undefined ? [] : [{ path: pattern, type }]
    }
    const entries = yield* walk(target.environment.files, root, {
      // Deep enough for every segment after the fixed part; `**` can match any depth.
      depth: pattern.includes("**") ? Infinity : segments.length - wild,
      // Without `dot`, only a segment that names a leading dot itself matches inside a hidden directory.
      hidden: dot || segments.slice(wild).some((segment) => /(^|[{,(|])\./.test(segment)),
    }).pipe(
      // As in Bun, a fixed part that isn't a directory matches nothing, while a `cwd` that isn't one fails.
      Effect.catchIf(
        (error) => wild > 0 && error._tag !== "Environment.Failed",
        () => Effect.succeed([]),
      ),
    )
    return entries
      .map((entry) => ({
        path: path.isAbsolute(pattern) ? path.join(base, entry.path) : path.join(path.relative(cwd, base), entry.path),
        type: entry.type,
      }))
      .filter((entry) => Glob.match(pattern, entry.path, { dot }))
  })

type Entry = { readonly path: string; readonly type: Environment.FileType }

// Lists `depth` levels below `directory`: 1 is its own entries, Infinity everything. It goes into a directory whose
// name starts with a dot only when `hidden` is set.
const walk = (
  files: Environment.Files,
  directory: string,
  options: { readonly depth: number; readonly hidden: boolean },
  prefix = "",
): Effect.Effect<Array<Entry>, Environment.NotFound | Environment.WrongKind | Environment.Failed> =>
  files.list(path.join(directory, prefix)).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (entry) => {
        const item = { path: path.join(prefix, entry.name), type: entry.type }
        if (options.depth <= 1 || entry.type !== "directory" || (!options.hidden && entry.name.startsWith(".")))
          return Effect.succeed([item])
        return walk(files, directory, { ...options, depth: options.depth - 1 }, item.path).pipe(
          Effect.map((inside) => [item, ...inside]),
        )
      }),
    ),
    Effect.map((items) => items.flat()),
  )

// Only part of Bun's options are implemented. Naming another fails, since ignoring it would give a wrong result.
const supports = (api: string, options: object | undefined, supported: ReadonlyArray<string>) => {
  const unsupported = Object.keys(options ?? {}).find((key) => !supported.includes(key))
  if (unsupported === undefined) return
  throw new TypeError(
    `${api} does not support the "${unsupported}" option in Code Mode. Supported options: ${supported.join(", ")}.`,
  )
}

const toPath = (input: string | URL) =>
  typeof input === "string" && !input.startsWith("file:") ? input : fileURLToPath(input)

const messages = {
  ENOENT: "no such file or directory",
  EISDIR: "illegal operation on a directory",
  ENOTDIR: "not a directory",
}

const nodeError = (error: unknown, syscall: string, file: string) => {
  const code = codeOf(error)
  if (code)
    return Object.assign(new Error(`${code}: ${messages[code]}, ${syscall} '${file}'`), {
      code,
      errno: -constants.errno[code],
      syscall,
      path: file,
    })
  if (error instanceof Environment.Failed && error.cause instanceof Error) return error.cause
  return error
}

const codeOf = (error: unknown) => {
  if (error instanceof Environment.NotFound) return "ENOENT"
  if (error instanceof Environment.WrongKind) return error.actual === "directory" ? "EISDIR" : "ENOTDIR"
}

// Bun's MIME types for common extensions, with the charset Bun adds to some text types.
const types = Object.fromEntries(
  Object.entries({
    "text/plain;charset=utf-8": ["txt", "log", "ini"],
    "text/javascript;charset=utf-8": ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"],
    "application/json;charset=utf-8": ["json", "map"],
    "text/html;charset=utf-8": ["html", "htm"],
    "text/css;charset=utf-8": ["css"],
    "text/markdown": ["md"],
    "text/csv": ["csv"],
    "text/yaml": ["yaml", "yml"],
    "application/toml": ["toml"],
    "application/xml": ["xml"],
    "application/pdf": ["pdf"],
    "application/zip": ["zip"],
    "application/gzip": ["gz"],
    "application/x-tar": ["tar"],
    "application/wasm": ["wasm"],
    "image/svg+xml": ["svg"],
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/gif": ["gif"],
    "image/webp": ["webp"],
    "image/avif": ["avif"],
    "image/x-icon": ["ico"],
    "audio/mpeg": ["mp3"],
    "audio/x-wav": ["wav"],
    "video/mp4": ["mp4"],
    "video/webm": ["webm"],
    "font/woff": ["woff"],
    "font/woff2": ["woff2"],
    "font/ttf": ["ttf"],
    "font/otf": ["otf"],
  }).flatMap(([type, extensions]) => extensions.map((extension) => [extension, type])),
)

const mime = (name: string) => types[path.extname(name).slice(1).toLowerCase()] ?? "application/octet-stream"

/** A subset of Bun's file APIs, over the session's files and with the permissions the file tools ask. */
export const extension = Extension.make({
  name: "bun",
  modules: { bun: "Bun" },
  globals: {
    Bun: {
      file: open,
      write: Extension.async(writeTo),
      Glob: Extension.constructible((pattern: string) => {
        if (typeof pattern !== "string") throw new TypeError("Bun.Glob expects a pattern string.")
        return {
          scan: (options?: string | ScanOptions) => scan(pattern, options),
          scanSync: (options?: string | ScanOptions) => scan(pattern, options),
          // As in Bun, `match` takes a dot file that a scan without `dot` leaves out.
          match: (name: string) => Glob.match(pattern, name),
        }
      }),
    },
  },
})

/** What to show for a Bun call: the function, its path or pattern, and the file a write copies. */
export const display = (name: string, args: ReadonlyArray<unknown>) => {
  const from = name === "Bun.write" ? handleOf(args[1])?.name : undefined
  return {
    method: name.slice(name.lastIndexOf(".") + 1),
    path: handleOf(args[0])?.name ?? String(args[0]),
    ...(from === undefined ? {} : { from }),
  }
}
