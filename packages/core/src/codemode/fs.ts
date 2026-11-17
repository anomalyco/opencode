export * as CodeModeFs from "./fs.js"

import { Extension } from "@opencode/codemode"
import type { Context as ToolContext } from "@opencode/schema/tool"
import { Effect } from "effect"
import { constants as os } from "os"
import path from "path"
import { fileURLToPath } from "url"
import { Glob } from "@opencode/util/glob"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { FileWrite } from "../file-write.js"
import { Location } from "../location.js"
import { fileDiff } from "../tool/plugin/file-diff.js"
import { CodeModeExecution } from "./execution.js"

/** The services the `fs` global needs from the execute call's Location. */
export type Services = FileAccess.Service | FileWrite.Service | Environment.Service | Location.Service

type Host = {
  readonly context: ToolContext
  readonly access: FileAccess.Interface
  readonly fileWrite: FileWrite.Interface
  readonly files: Environment.Files
}
// "buffer" asks for a Buffer where Node would otherwise return a string (readdir names, readlink, realpath).
type Encoding = BufferEncoding | "buffer" | { readonly encoding?: BufferEncoding | "buffer" | null } | null
type Data = string | Uint8Array
type PathLike = string | URL
type Op = (...args: never[]) => Effect.Effect<unknown, unknown, Services | CodeModeExecution.Service>

// Each operation is written once and backs both `fs.promises.x` and `fs.xSync`. Reads ask the read permission like the
// read tool; every mutation asks edit for each path it touches, so the same rules and prompts apply.
const ops = {
  readFile: op("open", function* (host, file, options?: Encoding) {
    const bytes = (yield* host.files.read(yield* read(host, file))).bytes
    const encoding = typeof options === "string" ? options : options?.encoding
    return encoding && encoding !== "buffer" ? Buffer.from(bytes).toString(encoding) : Buffer.from(bytes)
  }),
  writeFile: op("open", function* (host, file, data: Data, options?: Encoding | { readonly flag?: string }) {
    const flag = typeof options === "object" && options !== null && "flag" in options ? options.flag : undefined
    if (flag?.startsWith("a")) return yield* append(host, file, toBytes(data, encodingOf(options)))
    if (flag?.includes("x")) {
      const [absolute] = yield* outside(host, [file])
      if ((yield* typeOf(host, absolute!)) !== undefined) return yield* Effect.fail("EEXIST" as const)
    }
    yield* write(host, file, toBytes(data, encodingOf(options)))
  }),
  appendFile: op("open", (host, file, data: Data, options?: Encoding) => append(host, file, toBytes(data, options))),
  readdir: op("scandir", function* (host, file, options?: Encoding | { withFileTypes?: boolean; recursive?: boolean }) {
    const settings = typeof options === "object" && options !== null ? options : {}
    const entries = yield* walk(
      host.files,
      yield* read(host, file),
      "recursive" in settings && settings.recursive === true ? Infinity : 1,
    )
    if (!("withFileTypes" in settings) || settings.withFileTypes !== true)
      return entries.map((entry) => (encodingOf(options) === "buffer" ? Buffer.from(entry.path) : entry.path))
    return entries.map((entry) =>
      dirent(path.basename(entry.path), path.join(file, path.dirname(entry.path)), entry.type),
    )
  }),
  stat: op("stat", function* (host, file, options?: { throwIfNoEntry?: boolean }) {
    return yield* missingIsUndefined(stat(host, file, true), options)
  }),
  lstat: op("lstat", function* (host, file, options?: { throwIfNoEntry?: boolean }) {
    return yield* missingIsUndefined(stat(host, file, false), options)
  }),
  access: op("access", function* (host, file) {
    yield* Environment.typeFollowing(host.files, yield* read(host, file))
  }),
  mkdir: op("mkdir", function* (host, file, options?: { recursive?: boolean }) {
    if (options?.recursive === true) return yield* mkdirp(host, file)
    const [absolute] = yield* edit(host, [file])
    if ((yield* typeOf(host, absolute!)) !== undefined) return yield* Effect.fail("EEXIST" as const)
    if ((yield* typeOf(host, path.dirname(absolute!))) === undefined) return yield* Effect.fail("ENOENT" as const)
    yield* host.files.mkdir(absolute!)
  }),
  // A new directory named `prefix` plus six random characters.
  mkdtemp: op("mkdtemp", function* (host, prefix) {
    for (;;) {
      const directory =
        prefix + Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => alphabet[byte % 62]).join("")
      const [absolute] = yield* edit(host, [directory])
      if ((yield* typeOf(host, absolute!)) !== undefined) continue
      if ((yield* typeOf(host, path.dirname(absolute!))) === undefined) return yield* Effect.fail("ENOENT" as const)
      yield* host.files.mkdir(absolute!)
      return directory
    }
  }),
  rmdir: op("rmdir", function* (host, file, options?: { recursive?: boolean }) {
    const [absolute] = yield* outside(host, [file])
    const type = yield* typeOf(host, absolute!)
    if (type === undefined) return yield* Effect.fail("ENOENT" as const)
    if (type !== "directory") return yield* Effect.fail("ENOTDIR" as const)
    const inside = yield* tree(host, absolute!)
    if (inside.length > 0 && options?.recursive !== true) return yield* Effect.fail("ENOTEMPTY" as const)
    yield* edit(host, [absolute!, ...inside.map((item) => path.join(absolute!, item))])
    yield* host.files.remove(absolute!)
  }),
  truncate: op("open", function* (host, file, length?: number) {
    const [absolute] = yield* edit(host, [file])
    yield* host.files.truncate(absolute!, Math.max(0, length ?? 0))
  }),
  rm: op("rm", remove),
  unlink: op("unlink", (host, file) => remove(host, file)),
  rename: op("rename", function* (host, file, to: PathLike) {
    const [source, target] = yield* outside(host, [file, toPath(to)])
    // As in Node: a directory may replace an empty directory; anything else onto a directory fails.
    if ((yield* typeOf(host, target)) === "directory") {
      if ((yield* typeOf(host, source)) !== "directory") return yield* Effect.fail("EISDIR" as const)
      if ((yield* tree(host, target)).length > 0) return yield* Effect.fail("ENOTEMPTY" as const)
    }
    // Paths inside a moved directory change too, under both their old and new names.
    const inside = yield* tree(host, source)
    yield* edit(host, [source, target, ...inside.flatMap((item) => [path.join(source, item), path.join(target, item)])])
    if ((yield* typeOf(host, target)) === "directory") yield* host.files.remove(target)
    yield* host.files.move(source, target)
  }),
  copyFile: op("copyfile", function* (host, file, to: PathLike, mode?: number) {
    const bytes = (yield* host.files.read(yield* read(host, file))).bytes
    const destination = toPath(to)
    if ((mode ?? 0) & constants.COPYFILE_EXCL) {
      const [absolute] = yield* outside(host, [destination])
      if ((yield* typeOf(host, absolute!)) !== undefined) return yield* Effect.fail("EEXIST" as const)
    }
    yield* write(host, destination, bytes)
  }),
  cp: op(
    "cp",
    function* (host, file, to: PathLike, options?: { recursive?: boolean; force?: boolean; errorOnExist?: boolean }) {
      const destination = toPath(to)
      const [source] = yield* outside(host, [file])
      const type = yield* typeOf(host, yield* read(host, file))
      if (type === undefined) return yield* Effect.fail("ENOENT" as const)
      const overwrite = options?.force !== false
      const copyOne = function* (from: string, into: string) {
        const bytes = (yield* host.files.read(yield* read(host, from))).bytes
        const [absolute] = yield* outside(host, [into])
        if ((yield* typeOf(host, absolute!)) !== undefined && !overwrite) {
          if (options?.errorOnExist === true) return yield* Effect.fail("EEXIST" as const)
          return
        }
        yield* write(host, into, bytes)
      }
      if (type !== "directory") return yield* copyOne(file, destination)
      if (options?.recursive !== true) return yield* Effect.fail("EISDIR" as const)
      const entries = yield* walk(host.files, source!, Infinity)
      for (const entry of entries.filter((item) => item.type === "directory"))
        yield* mkdirp(host, path.join(destination, entry.path))
      yield* mkdirp(host, destination)
      for (const entry of entries.filter((item) => item.type !== "directory"))
        yield* copyOne(path.join(file, entry.path), path.join(destination, entry.path))
    },
  ),
  glob: op(
    "scandir",
    function* (host, pattern, options?: { cwd?: string; exclude?: ReadonlyArray<string>; withFileTypes?: boolean }) {
      const cwd = options?.cwd ?? "."
      const segments = pattern.split("/")
      const literal = segments.findIndex((segment) => /[*?[\]{}()!+@]/.test(segment))
      // The fixed part of the pattern is where listing starts, and what read permission is asked for. An absolute
      // pattern keeps its root and gives absolute paths, as in Node.
      const fixed =
        (literal < 0 ? segments : segments.slice(0, literal)).join("/") || (path.isAbsolute(pattern) ? "/" : ".")
      const base = path.isAbsolute(pattern) ? fixed : path.join(cwd, fixed)
      const root = yield* read(host, base)
      const shown = (relative: string) =>
        path.isAbsolute(pattern) ? path.join(base, relative) : path.join(path.relative(cwd, base), relative)
      const matches = (relative: string) =>
        Glob.match(pattern, shown(relative), { dot: false }) &&
        !(options?.exclude ?? []).some((item) => Glob.match(item, shown(relative), { dot: false }))
      if (literal < 0) {
        const type = yield* typeOf(host, root)
        if (type === undefined) return []
        return [options?.withFileTypes === true ? dirent(path.basename(base), path.dirname(base), type) : pattern]
      }
      // Deep enough for every segment after the fixed part; `**` can match any depth.
      const depth = pattern.includes("**") ? Infinity : segments.length - literal
      const entries = (yield* walk(host.files, root, depth)).filter((entry) => matches(entry.path))
      if (options?.withFileTypes === true)
        return entries.map((entry) =>
          dirent(path.basename(entry.path), path.join(base, path.dirname(entry.path)), entry.type),
        )
      return entries.map((entry) => shown(entry.path))
    },
  ),
}

const variants = (wrap: (operation: Op) => Op, suffix: string) =>
  Object.fromEntries(Object.entries(ops).map(([name, operation]: [string, Op]) => [name + suffix, wrap(operation)]))
const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 }

export const extension = Extension.make({
  name: "fs",
  globals: {
    fs: {
      // A copy that isn't marked async is synchronous, and blocks on the Effect it returns.
      ...variants((operation) => operation.bind(undefined), "Sync"),
      // As in Node, existsSync never throws: a path it may not check doesn't exist.
      existsSync: (file: PathLike) =>
        op("access", function* (host, file) {
          return yield* Environment.exists(host.files, yield* read(host, file))
        })(file).pipe(Effect.orElseSucceed(() => false)),
      constants,
      promises: { ...variants(Extension.async, ""), constants },
    },
  },
})

/** What to show for an fs call: the method and the path. */
export const display = (name: string, args: ReadonlyArray<unknown>) => ({
  method: name.slice(name.lastIndexOf(".") + 1),
  path: String(args[0]),
})

function op<Args extends ReadonlyArray<unknown>, A>(
  syscall: string,
  body: (host: Host, file: string, ...args: Args) => Generator<Effect.Effect<unknown, unknown>, A, unknown>,
) {
  return (input: PathLike, ...args: Args) => {
    const file = toPath(input)
    return Effect.gen(function* () {
      const host = {
        context: yield* CodeModeExecution.Service,
        access: yield* FileAccess.Service,
        fileWrite: yield* FileWrite.Service,
        files: (yield* Environment.Service).files,
      }
      return yield* body(host, file, ...args)
    }).pipe(Effect.mapError((error) => nodeError(error, syscall, file)))
  }
}

const toPath = (input: PathLike) =>
  typeof input === "string" && !input.startsWith("file:") ? input : fileURLToPath(input)

function* read(host: Host, file: string) {
  return (yield* host.access.authorizeRead(file, host.context)).absolute
}

// Approves paths outside the project before anything looks at them on disk, so a program can't learn what exists
// there without approval.
function* outside(host: Host, files: ReadonlyArray<string>) {
  const targets = yield* Effect.forEach(files, (file) => host.access.resolve({ path: file }))
  yield* host.access.authorizeExternal(targets, host.context)
  return targets.map((target) => target.absolute)
}

// One edit request covering every path, after any external-directory approval.
function* edit(host: Host, files: ReadonlyArray<string>) {
  const targets = yield* Effect.forEach(files, (file) => host.access.resolve({ path: file, kind: "file" }))
  yield* host.access.authorizeExternal(targets, host.context)
  yield* host.fileWrite.authorize(targets, host.context)
  return targets.map((target) => target.absolute)
}

// Writes exactly these bytes, as Node does: no formatting and no BOM handling. The edit request shows the change as a
// diff when both sides are text, like the write tool's. A missing parent directory is ENOENT, as in Node.
function* write(host: Host, file: string, content: Uint8Array) {
  yield* host.files.write(yield* prepare(host, file, content, false), content)
}

function* append(host: Host, file: string, bytes: Uint8Array) {
  yield* host.files.append(yield* prepare(host, file, bytes, true), bytes)
}

// Resolves a file a write will change, checks Node's preconditions, and asks edit permission with the change as a diff
// when it is text. A replacing write diffs against the current file, as the write tool does. An append never reads the
// file: its diff shows only the bytes being added.
function* prepare(host: Host, file: string, content: Uint8Array, appending: boolean) {
  const target = yield* host.fileWrite.target(file, host.context)
  const type = yield* typeOf(host, target.absolute)
  if (type === "directory") return yield* Effect.fail("EISDIR" as const)
  if (type === undefined && (yield* typeOf(host, path.dirname(target.absolute))) === undefined)
    return yield* Effect.fail("ENOENT" as const)
  const before = appending || type === undefined ? "" : text((yield* host.files.read(target.absolute)).bytes)
  const after = text(content)
  yield* host.fileWrite.authorize(
    target,
    host.context,
    before !== undefined && after !== undefined
      ? fileDiff(target.resource, before, after, type === undefined ? "added" : "modified")
      : undefined,
  )
  return target.absolute
}

// Bytes as text when they are valid UTF-8.
const text = (bytes: Uint8Array) => {
  const decoded = Buffer.from(bytes).toString("utf8")
  return Buffer.from(decoded).equals(bytes) ? decoded : undefined
}

// A recursive mkdir: like Node, it returns the first directory it created, written the way the path was given, or
// undefined when the directory already existed.
function* mkdirp(host: Host, file: string): Generator<Effect.Effect<unknown, unknown>, string | undefined, unknown> {
  const [absolute] = yield* edit(host, [file])
  const existing = yield* typeOf(host, absolute!)
  if (existing === "directory") return undefined
  if (existing !== undefined) return yield* Effect.fail("EEXIST" as const)
  const created = yield* firstMissing(host, absolute!)
  yield* host.files.mkdir(absolute!)
  return path.join(file, path.relative(absolute!, created))
}

// The first directory that doesn't exist yet on the way to `absolute`.
function* firstMissing(host: Host, absolute: string): Generator<Effect.Effect<unknown, unknown>, string, unknown> {
  const parent = path.dirname(absolute)
  if (parent === absolute) return absolute
  const type = yield* typeOf(host, parent)
  if (type === undefined) return yield* firstMissing(host, parent)
  if (type !== "directory" && type !== "symlink") return yield* Effect.fail("ENOTDIR" as const)
  return absolute
}

// `throwIfNoEntry: false` makes a missing path undefined instead of ENOENT.
const missingIsUndefined = <A, E, R>(
  effect: Generator<Effect.Effect<unknown, unknown>, A, unknown>,
  options?: { readonly throwIfNoEntry?: boolean },
) =>
  Effect.gen(() => effect).pipe(
    Effect.catchIf(
      (error) => options?.throwIfNoEntry === false && error instanceof Environment.NotFound,
      () => Effect.undefined,
    ),
  )

// Every path inside a removed directory is authorized, so an edit rule for one of them still applies.
function* remove(host: Host, file: string, options?: { recursive?: boolean; force?: boolean }) {
  const [absolute] = yield* outside(host, [file])
  const type = yield* typeOf(host, absolute)
  if (type === undefined && options?.force === true) return
  if (type === undefined) return yield* new Environment.NotFound({ path: absolute })
  if (type === "directory" && options?.recursive !== true)
    return yield* new Environment.WrongKind({ path: absolute, actual: type })
  yield* edit(host, [absolute, ...(yield* tree(host, absolute)).map((item) => path.join(absolute, item))])
  yield* host.files.remove(absolute)
}

function* stat(host: Host, file: string, follow: boolean) {
  const absolute = yield* read(host, file)
  const own = yield* host.files.stat(absolute)
  // `stat` describes what a symlink points at; reading zero bytes resolves it. A directory target keeps the link's size.
  const info =
    follow && own.type === "symlink"
      ? yield* host.files.read(absolute, { offset: 0, length: 0 }).pipe(
          Effect.map((result) => result.info),
          Effect.catchTag("Environment.WrongKind", () => Effect.succeed({ ...own, type: "directory" as const })),
        )
      : own
  return { size: info.size, mtimeMs: info.mtimeMs, mtime: new Date(info.mtimeMs), ...kind(info.type) }
}

const typeOf = (host: Host, absolute: string) =>
  host.files.stat(absolute).pipe(
    Effect.map((info) => info.type),
    Effect.catchTag("Environment.NotFound", () => Effect.undefined),
  )

// The paths inside a directory, relative to it; nothing for a file.
const tree = (host: Host, absolute: string) =>
  walk(host.files, absolute, Infinity).pipe(
    Effect.map((entries) => entries.map((entry) => entry.path)),
    Effect.orElseSucceed(() => []),
  )

type Entry = { readonly path: string; readonly type: Environment.FileType }

// Lists `depth` levels below `directory`: 1 is its own entries, Infinity everything.
const walk = (
  files: Environment.Files,
  directory: string,
  depth: number,
  prefix = "",
): Effect.Effect<Array<Entry>, Environment.NotFound | Environment.WrongKind | Environment.Failed> =>
  files.list(path.join(directory, prefix)).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (entry) => {
        const item = { path: path.join(prefix, entry.name), type: entry.type }
        if (depth <= 1 || entry.type !== "directory") return Effect.succeed([item])
        return walk(files, directory, depth - 1, item.path).pipe(Effect.map((inside) => [item, ...inside]))
      }),
    ),
    Effect.map((items) => items.flat()),
  )

const kind = (type: Environment.FileType) => ({
  isFile: () => type === "file",
  isDirectory: () => type === "directory",
  isSymbolicLink: () => type === "symlink",
  isFIFO: () => false,
  isSocket: () => false,
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
})

// Node's Dirent: `path` is the deprecated name of `parentPath`.
const dirent = (name: string, parentPath: string, type: Environment.FileType) => ({
  name,
  parentPath,
  path: parentPath,
  ...kind(type),
})

const textEncoding = (encoding: BufferEncoding | "buffer" | null | undefined): BufferEncoding =>
  encoding && encoding !== "buffer" ? encoding : "utf8"

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// The encoding an options argument names: a string, or an object's `encoding`.
const encodingOf = (options: unknown): BufferEncoding | "buffer" | undefined => {
  if (typeof options === "string") return options as BufferEncoding | "buffer"
  if (typeof options !== "object" || options === null || !("encoding" in options)) return undefined
  return typeof options.encoding === "string" ? (options.encoding as BufferEncoding | "buffer") : undefined
}

const toBytes = (data: Data, options?: Encoding) =>
  typeof data === "string"
    ? Buffer.from(data, textEncoding(typeof options === "string" ? options : options?.encoding))
    : data

const messages = {
  ENOENT: "no such file or directory",
  EEXIST: "file already exists",
  EISDIR: "illegal operation on a directory",
  ENOTDIR: "not a directory",
  ENOTEMPTY: "directory not empty",
}

// Errors carry Node's `code`, `syscall` and `path`, so `e.code === "ENOENT"` works.
const nodeError = (error: unknown, syscall: string, file: string) => {
  const code = codeOf(error)
  if (code)
    return Object.assign(new Error(`${code}: ${messages[code]}, ${syscall} '${file}'`), {
      code,
      errno: -os.errno[code],
      syscall,
      path: file,
    })
  if (error instanceof Environment.Failed && error.cause instanceof Error) return error.cause
  return error
}

const codeOf = (error: unknown): keyof typeof messages | undefined => {
  if (typeof error === "string" && error in messages) return error as keyof typeof messages
  if (error instanceof Environment.NotFound) return "ENOENT"
  if (error instanceof Environment.WrongKind) return error.actual === "directory" ? "EISDIR" : "ENOTDIR"
}
