export * as CodeModeFs from "./fs.js"

import { Extension } from "@opencode/codemode"
import type { Context as ToolContext } from "@opencode/schema/tool"
import { Effect } from "effect"
import path from "path"
import { fileURLToPath } from "url"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { FileMutation } from "../file-mutation.js"
import { FileWrite } from "../file-write.js"
import { Permission } from "../permission.js"
import { CodeModeExecution } from "./execution.js"

/** The services the `fs` global needs from the execute call's Location. */
export type Services = FileAccess.Service | FileWrite.Service | FileMutation.Service | Environment.Service

type PathLike = string | URL
type EncodingOption = BufferEncoding | { readonly encoding?: BufferEncoding | null } | null | undefined
type Data = string | Uint8Array

// Reads ask the read permission and writes go through FileWrite, so the rules, prompts, diffs and formatting match the
// read and write tools. Errors carry Node's `code`, `syscall` and `path`, so `e.code === "ENOENT"` works.
const readFile = (file: PathLike, options?: EncodingOption) =>
  run("open", file, (host, file) =>
    Effect.gen(function* () {
      const target = yield* host.access.authorizeRead(file, host.execution)
      const bytes = (yield* host.files.read(target.absolute)).bytes
      const encoding = encodingOf(options)
      return encoding ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(encoding) : bytes
    }),
  )

const writeFile = (file: PathLike, data: Data, options?: EncodingOption) =>
  run("open", file, (host, file) => write(host, file, bytesOrText(data, options)))

const appendFile = (file: PathLike, data: Data, options?: EncodingOption) =>
  run("open", file, (host, file) =>
    Effect.gen(function* () {
      const target = yield* host.access.resolve({ path: file, kind: "file" })
      const current = yield* host.files.read(target.absolute).pipe(
        Effect.map((result) => result.bytes),
        Effect.catchTag("Environment.NotFound", () => Effect.succeed(new Uint8Array())),
      )
      const added = bytesOrText(data, options)
      yield* write(host, file, Buffer.concat([current, typeof added === "string" ? Buffer.from(added) : added]))
    }),
  )

const readdir = (
  file: PathLike,
  options?: { readonly withFileTypes?: boolean; readonly recursive?: boolean } | BufferEncoding | null,
) =>
  run("scandir", file, (host, file) =>
    Effect.gen(function* () {
      const target = yield* host.access.authorizeRead(file, host.execution)
      const recursive = typeof options === "object" && options?.recursive === true
      const entries = yield* walk(host.files, target.absolute, recursive)
      if (typeof options !== "object" || options?.withFileTypes !== true) return entries.map((entry) => entry.relative)
      return entries.map((entry) => ({
        name: path.basename(entry.relative),
        parentPath: path.join(file, path.dirname(entry.relative)),
        ...kind(entry.type),
      }))
    }),
  )

const stat = (file: PathLike) => run("stat", file, (host, file) => statOf(host, file, true))

const lstat = (file: PathLike) => run("lstat", file, (host, file) => statOf(host, file, false))

const access = (file: PathLike, _mode?: number) =>
  run("access", file, (host, file) =>
    Effect.gen(function* () {
      const target = yield* host.access.authorizeRead(file, host.execution)
      yield* Environment.typeFollowing(host.files, target.absolute)
    }),
  )

const existsSync = (file: PathLike) =>
  run("access", file, (host, file) =>
    Effect.gen(function* () {
      const target = yield* host.access.authorizeRead(file, host.execution)
      return yield* Environment.exists(host.files, target.absolute)
    }),
  )

const mkdir = (file: PathLike, options?: { readonly recursive?: boolean } | number) =>
  run("mkdir", file, (host, file) =>
    Effect.gen(function* () {
      const target = yield* host.fileWrite.target(file, host.execution)
      yield* host.fileWrite.authorize(target, host.execution)
      if (typeof options !== "object" || options.recursive !== true) {
        if (yield* Environment.exists(host.files, target.absolute)) return yield* systemError("EEXIST", "mkdir", file)
        if (!(yield* Environment.exists(host.files, path.dirname(target.absolute))))
          return yield* systemError("ENOENT", "mkdir", file)
      }
      yield* host.files.mkdir(target.absolute)
    }),
  )

const rm = (file: PathLike, options?: { readonly recursive?: boolean; readonly force?: boolean }) =>
  run("rm", file, (host, file) =>
    Effect.gen(function* () {
      const target = yield* host.fileWrite.target(file, host.execution)
      const info = yield* optionalStat(host, target.absolute)
      if (info === undefined) return options?.force === true ? undefined : yield* systemError("ENOENT", "rm", file)
      if (info.type === "directory" && options?.recursive !== true) return yield* systemError("EISDIR", "rm", file)
      // Every file inside a removed directory is authorized, so an edit rule for one of them still applies.
      yield* host.fileWrite.authorize(yield* tree(host, target, info), host.execution)
      yield* host.files.remove(target.absolute)
    }),
  )

const unlink = (file: PathLike) =>
  run("unlink", file, (host, file) =>
    Effect.gen(function* () {
      const target = yield* host.fileWrite.target(file, host.execution)
      const info = yield* host.files.stat(target.absolute)
      if (info.type === "directory") return yield* systemError("EISDIR", "unlink", file)
      yield* host.fileWrite.authorize(target, host.execution)
      yield* host.files.remove(target.absolute)
    }),
  )

const rename = (from: PathLike, to: PathLike) =>
  run("rename", from, (host, file) =>
    Effect.gen(function* () {
      const source = yield* host.fileWrite.target(file, host.execution)
      const destination = yield* host.fileWrite.target(toPath(to), host.execution)
      const info = yield* host.files.stat(source.absolute)
      const existing = yield* optionalStat(host, destination.absolute)
      if (existing?.type === "directory")
        return yield* systemError(info.type === "directory" ? "ENOTEMPTY" : "EISDIR", "rename", file)
      if (existing && info.type === "directory") return yield* systemError("ENOTDIR", "rename", file)
      const moved = yield* tree(host, source, info)
      const arriving = yield* Effect.forEach(moved.slice(1), (item) =>
        host.access.resolve({
          path: path.join(destination.absolute, path.relative(source.absolute, item.absolute)),
          kind: "file",
        }),
      )
      yield* host.fileWrite.authorize([...moved, destination, ...arriving], host.execution)
      yield* host.files.move(source.absolute, destination.absolute)
    }),
  )

const copyFile = (from: PathLike, to: PathLike, _mode?: number) =>
  run("copyfile", from, (host, file) =>
    Effect.gen(function* () {
      const source = yield* host.access.authorizeRead(file, host.execution)
      yield* write(host, toPath(to), (yield* host.files.read(source.absolute)).bytes)
    }),
  )

const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 }

export const extension = Extension.make({
  name: "fs",
  globals: {
    fs: {
      promises: {
        readFile: Extension.async(readFile),
        writeFile: Extension.async(writeFile),
        appendFile: Extension.async(appendFile),
        readdir: Extension.async(readdir),
        stat: Extension.async(stat),
        lstat: Extension.async(lstat),
        access: Extension.async(access),
        mkdir: Extension.async(mkdir),
        rm: Extension.async(rm),
        unlink: Extension.async(unlink),
        rename: Extension.async(rename),
        copyFile: Extension.async(copyFile),
        constants,
      },
      // Sync variants return the same Effect, which a synchronous global blocks on.
      readFileSync: (...args: Parameters<typeof readFile>) => readFile(...args),
      writeFileSync: (...args: Parameters<typeof writeFile>) => writeFile(...args),
      appendFileSync: (...args: Parameters<typeof appendFile>) => appendFile(...args),
      readdirSync: (...args: Parameters<typeof readdir>) => readdir(...args),
      statSync: (...args: Parameters<typeof stat>) => stat(...args),
      lstatSync: (...args: Parameters<typeof lstat>) => lstat(...args),
      accessSync: (...args: Parameters<typeof access>) => access(...args),
      existsSync,
      mkdirSync: (...args: Parameters<typeof mkdir>) => mkdir(...args),
      rmSync: (...args: Parameters<typeof rm>) => rm(...args),
      unlinkSync: (...args: Parameters<typeof unlink>) => unlink(...args),
      renameSync: (...args: Parameters<typeof rename>) => rename(...args),
      copyFileSync: (...args: Parameters<typeof copyFile>) => copyFile(...args),
      constants,
    },
  },
})

/** What to show for an fs call: the method and the path, plus the destination of a rename or copy. */
export const display = (name: string, args: ReadonlyArray<unknown>) => {
  const method = name.slice(name.lastIndexOf(".") + 1)
  const shown: Record<string, string> = { method, path: String(args[0]) }
  if (method.startsWith("rename") || method.startsWith("copyFile")) shown.destination = String(args[1])
  return shown
}

const run = <A, E, R>(syscall: string, file: PathLike, body: (host: Host, file: string) => Effect.Effect<A, E, R>) => {
  const resolved = toPath(file)
  return Effect.gen(function* () {
    const host: Host = {
      execution: yield* CodeModeExecution.Service,
      access: yield* FileAccess.Service,
      fileWrite: yield* FileWrite.Service,
      mutation: yield* FileMutation.Service,
      files: (yield* Environment.Service).files,
    }
    return yield* body(host, resolved)
  }).pipe(Effect.mapError((error) => nodeError(error, syscall, resolved)))
}

type Host = {
  readonly execution: ToolContext
  readonly access: FileAccess.Interface
  readonly fileWrite: FileWrite.Interface
  readonly mutation: FileMutation.Interface
  readonly files: Environment.Files
}

// Text, including bytes that are valid UTF-8, goes through FileWrite like the write tool; other bytes are written as is
// after the same approval, without a diff.
const write = (host: Host, file: string, content: Data) =>
  Effect.gen(function* () {
    const text = typeof content === "string" ? content : utf8(content)
    if (text !== undefined) return void (yield* host.fileWrite.write({ path: file, content: text }, host.execution))
    const target = yield* host.fileWrite.target(file, host.execution)
    yield* host.fileWrite.authorize(target, host.execution)
    yield* host.mutation.write({ target, content })
  })

const utf8 = (bytes: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return undefined
  }
}

const statOf = (host: Host, file: string, follow: boolean) =>
  Effect.gen(function* () {
    const target = yield* host.access.authorizeRead(file, host.execution)
    const info = yield* host.files.stat(target.absolute)
    const followed =
      follow && info.type === "symlink"
        ? yield* host.files.read(target.absolute, { offset: 0, length: 0 }).pipe(
            Effect.map((result) => result.info),
            Effect.catchTag("Environment.WrongKind", (error) => Effect.succeed({ ...info, type: error.actual })),
          )
        : info
    return { size: followed.size, mtimeMs: followed.mtimeMs, mtime: new Date(followed.mtimeMs), ...kind(followed.type) }
  })

const optionalStat = (host: Host, absolute: string) =>
  host.files.stat(absolute).pipe(Effect.catchTag("Environment.NotFound", () => Effect.undefined))

const kind = (type: Environment.FileType) => ({
  isFile: () => type === "file",
  isDirectory: () => type === "directory",
  isSymbolicLink: () => type === "symlink",
})

// A target and, for a directory, everything inside it.
const tree = (host: Host, target: FileAccess.Target, info: Environment.FileInfo) =>
  info.type !== "directory"
    ? Effect.succeed([target])
    : walk(host.files, target.absolute, true).pipe(
        Effect.flatMap((entries) =>
          Effect.forEach(entries, (entry) =>
            host.access.resolve({
              path: path.join(target.absolute, entry.relative),
              kind: entry.type === "directory" ? "directory" : "file",
            }),
          ),
        ),
        Effect.map((inside) => [target, ...inside]),
      )

type Entry = { readonly relative: string; readonly type: Environment.FileType }

const walk = (
  files: Environment.Files,
  directory: string,
  recursive: boolean,
  prefix = "",
): Effect.Effect<Array<Entry>, Environment.NotFound | Environment.WrongKind | Environment.Failed> =>
  files.list(directory).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (entry) => {
        const item = { relative: prefix === "" ? entry.name : path.join(prefix, entry.name), type: entry.type }
        if (!recursive || entry.type !== "directory") return Effect.succeed([item])
        return walk(files, path.join(directory, entry.name), true, item.relative).pipe(
          Effect.map((inside) => [item, ...inside]),
        )
      }),
    ),
    Effect.map((items) => items.flat()),
  )

const encodingOf = (options: EncodingOption) => (typeof options === "string" ? options : options?.encoding) ?? undefined

const bytesOrText = (data: Data, options: EncodingOption): Data => {
  const encoding = encodingOf(options)
  if (typeof data !== "string" || encoding === undefined || encoding === "utf8" || encoding === "utf-8") return data
  return Buffer.from(data, encoding)
}

const toPath = (file: PathLike) => {
  if (file instanceof URL) return fileURLToPath(file)
  if (typeof file === "string") return file
  throw new TypeError(`The "path" argument must be a string or a file URL. Received ${typeof file}`)
}

const descriptions = {
  ENOENT: [-2, "no such file or directory"],
  EEXIST: [-17, "file already exists"],
  EISDIR: [-21, "illegal operation on a directory"],
  ENOTDIR: [-20, "not a directory"],
  ENOTEMPTY: [-66, "directory not empty"],
} as const

const systemError = (code: keyof typeof descriptions, syscall: string, file: string) =>
  Effect.fail(nodeSystemError(code, syscall, file))

const nodeSystemError = (code: string, syscall: string, file: string, message?: string) => {
  const known = code in descriptions ? descriptions[code as keyof typeof descriptions] : undefined
  return Object.assign(new Error(known ? `${code}: ${known[1]}, ${syscall} '${file}'` : (message ?? code)), {
    ...(known ? { errno: known[0] } : {}),
    code,
    syscall,
    path: file,
  })
}

const nodeError = (error: unknown, syscall: string, file: string) => {
  if (error instanceof Environment.NotFound) return nodeSystemError("ENOENT", syscall, file)
  if (error instanceof Environment.WrongKind)
    return nodeSystemError(error.actual === "directory" ? "EISDIR" : "ENOTDIR", syscall, file)
  if (error instanceof Environment.Failed) {
    const cause: unknown = error.cause
    const code = cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : undefined
    if (code !== undefined && cause instanceof Error) return nodeSystemError(code, syscall, file, cause.message)
    return new Error(`${syscall} '${file}' failed: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  // The feedback is the user talking to the model, so it must reach the program as the error's message.
  if (error instanceof Permission.CorrectedError)
    return new Error(`The user rejected ${syscall} ${file}: ${error.feedback}`)
  return error
}
