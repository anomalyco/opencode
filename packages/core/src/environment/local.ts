import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type { Driver } from "./driver.js"
import { Failed, NotFound, WrongKind, type FileInfo, type FilesImpl, type FileType } from "./files.js"

/**
 * The host filesystem binding. Deliberately raw node:fs rather than effect's
 * FileSystem service or FSUtil: the contract needs lstat semantics (stat
 * reports "symlink"), and effect's node FileSystem stat always follows
 * symlinks. Nothing above the environment seam touches node:fs.
 */
export const makeLocalDriver = (spawner: ChildProcessSpawner["Service"]): Driver => {
  const overrides: FilesImpl = {
    read: (value, range) =>
      Effect.gen(function* () {
        const info = yield* stat(value, true)
        if (info.type !== "file") return yield* new WrongKind({ path: value, actual: info.type })
        if (range === undefined) {
          const bytes = yield* attempt(value, () => fs.readFile(value), true)
          return { info, bytes }
        }
        const bytes = yield* attempt(
          value,
          async () => {
            const handle = await fs.open(value, "r")
            try {
              const buffer = new Uint8Array(range.length)
              const result = await handle.read(buffer, 0, range.length, range.offset)
              return buffer.subarray(0, result.bytesRead)
            } finally {
              await handle.close()
            }
          },
          true,
        )
        return { info, bytes }
      }),
    stat: (value) => stat(value, false),
    list: (value) =>
      Effect.gen(function* () {
        const info = yield* stat(value, true)
        if (info.type !== "directory") return yield* new WrongKind({ path: value, actual: info.type })
        const entries = yield* attempt(value, () => fs.readdir(value, { withFileTypes: true }), true)
        return entries.map((entry) => ({ name: entry.name, type: fileType(entry) }))
      }),
    write: (value, bytes) =>
      attempt(value, async () => {
        await fs.mkdir(path.dirname(value), { recursive: true })
        await fs.writeFile(value, bytes)
      }),
    remove: (value) => attempt(value, () => fs.rm(value, { recursive: true, force: true })),
    move: (from, to) =>
      Effect.gen(function* () {
        yield* stat(from, false)
        const destination = yield* stat(to, false).pipe(
          Effect.map((info) => (info.type === "directory" ? path.join(to, path.basename(from)) : to)),
          Effect.catchIf(
            (error) => error instanceof NotFound,
            () => Effect.succeed(to),
          ),
        )
        yield* attempt(from, () => fs.rename(from, destination))
      }),
    mkdir: (value) => attempt(value, () => fs.mkdir(value, { recursive: true }).then(() => undefined)),
    append: (value, bytes) => attempt(value, () => fs.appendFile(value, bytes)),
    writeAt: (value, bytes, offset) =>
      attempt(value, async () => {
        // Read-write and created when missing, without O_TRUNC, so existing bytes outside the range stay.
        const handle = await fs.open(value, constants.O_RDWR | constants.O_CREAT)
        try {
          await handle.write(bytes, 0, bytes.length, offset)
        } finally {
          await handle.close()
        }
      }),
    truncate: (value, length) => attempt(value, () => fs.truncate(value, length), true),
    chmod: (value, mode) => attempt(value, () => fs.chmod(value, mode & 0o7777), true),
    chown: (value, uid, gid, follow) => attempt(value, () => (follow ? fs.chown : fs.lchown)(value, uid, gid), true),
    utimes: (value, atimeMs, mtimeMs, follow) =>
      attempt(value, () => (follow ? fs.utimes : fs.lutimes)(value, atimeMs / 1_000, mtimeMs / 1_000), true),
    symlink: (target, value) => attempt(value, () => fs.symlink(target, value)),
    readlink: (value) =>
      Effect.gen(function* () {
        const info = yield* stat(value, false)
        if (info.type !== "symlink") return yield* new WrongKind({ path: value, actual: info.type })
        return yield* attempt(value, () => fs.readlink(value), true)
      }),
    realpath: (value) => attempt(value, () => fs.realpath(value), true),
    link: (existing, value) => attempt(existing, () => fs.link(existing, value), true),
    statfs: (value) =>
      attempt(value, () => fs.statfs(value), true).pipe(
        Effect.map((info) => ({
          type: info.type,
          bsize: info.bsize,
          blocks: info.blocks,
          bfree: info.bfree,
          bavail: info.bavail,
          files: info.files,
          ffree: info.ffree,
        })),
      ),
  }

  return { spawner, overrides }
}

const stat = (value: string, follow: boolean) =>
  attempt(value, () => (follow ? fs.stat(value) : fs.lstat(value)), true).pipe(
    Effect.map(
      (stats): FileInfo => ({
        type: fileType(stats),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        dev: stats.dev,
        ino: stats.ino,
        mode: stats.mode,
        nlink: stats.nlink,
        uid: stats.uid,
        gid: stats.gid,
        rdev: stats.rdev,
        blksize: stats.blksize,
        blocks: stats.blocks,
        atimeMs: stats.atimeMs,
        ctimeMs: stats.ctimeMs,
        birthtimeMs: stats.birthtimeMs,
      }),
    ),
  )

const fileType = (entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileType => {
  if (entry.isFile()) return "file"
  if (entry.isDirectory()) return "directory"
  if (entry.isSymbolicLink()) return "symlink"
  return "other"
}

function attempt<A>(value: string, run: () => Promise<A>): Effect.Effect<A, Failed>
function attempt<A>(value: string, run: () => Promise<A>, missing: true): Effect.Effect<A, NotFound | Failed>
function attempt<A>(value: string, run: () => Promise<A>, missing = false) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      missing && isMissing(cause) ? new NotFound({ path: value }) : new Failed({ path: value, cause }),
  })
}

const isMissing = (cause: unknown) =>
  cause !== null &&
  typeof cause === "object" &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR")

export * as EnvironmentLocal from "./local.js"
