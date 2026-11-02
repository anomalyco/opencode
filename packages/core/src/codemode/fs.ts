export * as CodeModeFs from "./fs.js"

import { Extension } from "@opencode/codemode"
import type { Context as ToolContext } from "@opencode/schema/tool"
import { Effect } from "effect"
import path from "path"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { FileWrite } from "../file-write.js"
import { Permission } from "../permission.js"
import { CodeModeExecution } from "./execution.js"

/** The services the `fs` global needs from the execute call's Location. */
export type Services = FileAccess.Service | FileWrite.Service | Environment.Service

type Host = {
  readonly context: ToolContext
  readonly access: FileAccess.Interface
  readonly fileWrite: FileWrite.Interface
  readonly files: Environment.Files
}
type Encoding = BufferEncoding | { readonly encoding?: BufferEncoding | null } | null
type Data = string | Uint8Array
type Op = (...args: never[]) => Effect.Effect<unknown, unknown, Services | CodeModeExecution.Service>

// Each operation is written once and backs both `fs.promises.x` and `fs.xSync`. Reads ask the read permission like the
// read tool; every mutation asks edit for each path it touches, so the same rules and prompts apply.
const ops = {
  readFile: op("open", function* (host, file, options?: Encoding) {
    const bytes = (yield* host.files.read(yield* read(host, file))).bytes
    const encoding = typeof options === "string" ? options : options?.encoding
    return encoding ? Buffer.from(bytes).toString(encoding) : bytes
  }),
  writeFile: op("open", (host, file, data: Data, options?: Encoding) => write(host, file, toBytes(data, options))),
  appendFile: op("open", function* (host, file, data: Data, options?: Encoding) {
    const current = yield* host.files.read((yield* host.access.resolve({ path: file })).absolute).pipe(
      Effect.map((result) => result.bytes),
      Effect.catchTag("Environment.NotFound", () => Effect.succeed(new Uint8Array())),
    )
    yield* write(host, file, Buffer.concat([current, toBytes(data, options)]))
  }),
  readdir: op("scandir", function* (host, file, options?: { withFileTypes?: boolean; recursive?: boolean }) {
    const entries = yield* walk(host.files, yield* read(host, file), options?.recursive === true)
    if (options?.withFileTypes !== true) return entries.map((entry) => entry.path)
    return entries.map((entry) => ({ name: path.basename(entry.path), ...kind(entry.type) }))
  }),
  stat: op("stat", (host, file) => stat(host, file, true)),
  lstat: op("lstat", (host, file) => stat(host, file, false)),
  access: op("access", function* (host, file) {
    yield* Environment.typeFollowing(host.files, yield* read(host, file))
  }),
  mkdir: op("mkdir", function* (host, file, options?: { recursive?: boolean }) {
    const [absolute] = yield* edit(host, [file])
    if (options?.recursive !== true && (yield* Environment.exists(host.files, absolute)))
      return yield* Effect.fail("EEXIST" as const)
    yield* host.files.mkdir(absolute)
  }),
  rm: op("rm", remove),
  unlink: op("unlink", (host, file) => remove(host, file)),
  rename: op("rename", function* (host, file, to: string) {
    const source = (yield* host.access.resolve({ path: file })).absolute
    const target = (yield* host.access.resolve({ path: to })).absolute
    if ((yield* typeOf(host, target)) === "directory")
      return yield* new Environment.WrongKind({ path: target, actual: "directory" })
    // Paths inside a moved directory change too, under both their old and new names.
    const inside = yield* tree(host, source)
    yield* edit(host, [source, target, ...inside.flatMap((item) => [path.join(source, item), path.join(target, item)])])
    yield* host.files.move(source, target)
  }),
  copyFile: op("copyfile", function* (host, file, to: string) {
    yield* write(host, to, (yield* host.files.read(yield* read(host, file))).bytes)
  }),
}

const variants = (wrap: (operation: Op) => Op, suffix: string) =>
  Object.fromEntries(Object.entries(ops).map(([name, operation]: [string, Op]) => [name + suffix, wrap(operation)]))
const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }

export const extension = Extension.make({
  name: "fs",
  globals: {
    fs: {
      // A copy that isn't marked async is synchronous, and blocks on the Effect it returns.
      ...variants((operation) => operation.bind(undefined), "Sync"),
      existsSync: op("access", function* (host, file) {
        return yield* Environment.exists(host.files, yield* read(host, file))
      }),
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
  return (file: string, ...args: Args) =>
    Effect.gen(function* () {
      const host = {
        context: yield* CodeModeExecution.Service,
        access: yield* FileAccess.Service,
        fileWrite: yield* FileWrite.Service,
        files: (yield* Environment.Service).files,
      }
      return yield* body(host, file, ...args)
    }).pipe(Effect.mapError((error) => nodeError(error, syscall, file)))
}

function* read(host: Host, file: string) {
  return (yield* host.access.authorizeRead(file, host.context)).absolute
}

// One edit request covering every path, after any external-directory approval.
function* edit(host: Host, files: ReadonlyArray<string>) {
  const targets = yield* Effect.forEach(files, (file) => host.access.resolve({ path: file, kind: "file" }))
  yield* host.access.authorizeExternal(targets, host.context)
  yield* host.fileWrite.authorize(targets, host.context)
  return targets.map((target) => target.absolute)
}

// Valid UTF-8 goes through FileWrite like the write tool (diff, BOM, formatting); other bytes are written as they are.
function* write(host: Host, file: string, content: Uint8Array) {
  const text = Buffer.from(content).toString("utf8")
  if (Buffer.from(text).equals(content))
    return void (yield* host.fileWrite.write({ path: file, content: text }, host.context))
  const [absolute] = yield* edit(host, [file])
  yield* host.files.write(absolute, content)
}

// Every path inside a removed directory is authorized, so an edit rule for one of them still applies.
function* remove(host: Host, file: string, options?: { recursive?: boolean; force?: boolean }) {
  const absolute = (yield* host.access.resolve({ path: file })).absolute
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
  const info = yield* host.files.stat(absolute)
  const type = follow ? yield* Environment.typeFollowing(host.files, absolute) : info.type
  return { size: info.size, mtimeMs: info.mtimeMs, mtime: new Date(info.mtimeMs), ...kind(type) }
}

const typeOf = (host: Host, absolute: string) =>
  host.files.stat(absolute).pipe(
    Effect.map((info) => info.type),
    Effect.catchTag("Environment.NotFound", () => Effect.undefined),
  )

// The paths inside a directory, relative to it; nothing for a file.
const tree = (host: Host, absolute: string) =>
  walk(host.files, absolute, true).pipe(
    Effect.map((entries) => entries.map((entry) => entry.path)),
    Effect.orElseSucceed(() => []),
  )

type Entry = { readonly path: string; readonly type: Environment.FileType }

const walk = (
  files: Environment.Files,
  directory: string,
  recursive: boolean,
  prefix = "",
): Effect.Effect<Array<Entry>, Environment.NotFound | Environment.WrongKind | Environment.Failed> =>
  files.list(path.join(directory, prefix)).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (entry) => {
        const item = { path: path.join(prefix, entry.name), type: entry.type }
        if (!recursive || entry.type !== "directory") return Effect.succeed([item])
        return walk(files, directory, true, item.path).pipe(Effect.map((inside) => [item, ...inside]))
      }),
    ),
    Effect.map((items) => items.flat()),
  )

const kind = (type: Environment.FileType) => ({
  isFile: () => type === "file",
  isDirectory: () => type === "directory",
  isSymbolicLink: () => type === "symlink",
})

const toBytes = (data: Data, options?: Encoding) =>
  typeof data === "string"
    ? Buffer.from(data, (typeof options === "string" ? options : options?.encoding) ?? "utf8")
    : data

const messages = {
  ENOENT: "no such file or directory",
  EEXIST: "file already exists",
  EISDIR: "illegal operation on a directory",
  ENOTDIR: "not a directory",
}

// Errors carry Node's `code`, `syscall` and `path`, so `e.code === "ENOENT"` works.
const nodeError = (error: unknown, syscall: string, file: string) => {
  const code = codeOf(error)
  if (code)
    return Object.assign(new Error(`${code}: ${messages[code]}, ${syscall} '${file}'`), { code, syscall, path: file })
  if (error instanceof Environment.Failed && error.cause instanceof Error) return error.cause
  // The feedback is the user talking to the model, so it must reach the program as the error's message.
  if (error instanceof Permission.CorrectedError)
    return new Error(`The user rejected ${syscall} ${file}: ${error.feedback}`)
  return error
}

const codeOf = (error: unknown): keyof typeof messages | undefined => {
  if (error === "EEXIST") return error
  if (error instanceof Environment.NotFound) return "ENOENT"
  if (error instanceof Environment.WrongKind) return error.actual === "directory" ? "EISDIR" : "ENOTDIR"
}
