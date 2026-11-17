import { Effect, Schema } from "effect"

export const FileType = Schema.Literals(["file", "directory", "symlink", "other"])
export type FileType = typeof FileType.Type

export interface FileInfo {
  readonly type: FileType
  readonly size: number
  readonly mtimeMs: number
  /** The rest of POSIX stat, where the environment reports it. */
  readonly dev?: number
  readonly ino?: number
  /** File type and permission bits, as in `st_mode`. */
  readonly mode?: number
  readonly nlink?: number
  readonly uid?: number
  readonly gid?: number
  readonly rdev?: number
  readonly blksize?: number
  readonly blocks?: number
  readonly atimeMs?: number
  readonly ctimeMs?: number
  readonly birthtimeMs?: number
}

/** Free and total space on the filesystem holding a path, in blocks of `bsize` bytes, as `statfs(2)` reports it. */
export interface FilesystemInfo {
  readonly type: number
  readonly bsize: number
  readonly blocks: number
  readonly bfree: number
  readonly bavail: number
  readonly files: number
  readonly ffree: number
}

export interface DirEntry {
  readonly name: string
  readonly type: FileType
}

export class NotFound extends Schema.TaggedError<NotFound>()("Environment.NotFound", {
  path: Schema.String,
}) {}

export class WrongKind extends Schema.TaggedError<WrongKind>()("Environment.WrongKind", {
  path: Schema.String,
  actual: FileType,
}) {}

export class Failed extends Schema.TaggedError<Failed>()("Environment.Failed", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface FilesImpl {
  /**
   * Content operations (`read`, `list`) follow final symlinks; metadata operations (`stat` and entry
   * tags returned by `list`) do not. `info` describes the target file whose bytes are returned.
   * The process-backed default caps collected output at 64 MiB; larger whole-file reads fail with
   * `Failed`, so callers must use ranges for larger files.
   */
  readonly read: (
    path: string,
    range?: { readonly offset: number; readonly length: number },
  ) => Effect.Effect<{ readonly info: FileInfo; readonly bytes: Uint8Array }, NotFound | WrongKind | Failed>
  readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void, Failed>
  /** Describes the path entry itself, so a final symlink is reported as `symlink` rather than followed. */
  readonly stat: (path: string) => Effect.Effect<FileInfo, NotFound | Failed>
  /** Follows a final symlink to the listed directory while preserving each returned entry's own type. */
  readonly list: (path: string) => Effect.Effect<ReadonlyArray<DirEntry>, NotFound | WrongKind | Failed>
  readonly remove: (path: string) => Effect.Effect<void, Failed>
  readonly move: (from: string, to: string) => Effect.Effect<void, NotFound | Failed>
  readonly mkdir: (path: string) => Effect.Effect<void, Failed>
  /** Adds bytes to the end of a file, creating it when missing. */
  readonly append: (path: string, bytes: Uint8Array) => Effect.Effect<void, Failed>
  /** Writes bytes at `offset` without truncating, extending the file with zeros if needed; creates it when missing. */
  readonly writeAt: (path: string, bytes: Uint8Array, offset: number) => Effect.Effect<void, Failed>
  /** Cuts or zero-extends a file to `length` bytes. */
  readonly truncate: (path: string, length: number) => Effect.Effect<void, NotFound | Failed>
  /** Sets the permission bits (`mode & 0o7777`), following a final symlink. */
  readonly chmod: (path: string, mode: number) => Effect.Effect<void, NotFound | Failed>
  /** Sets the owner; `follow: false` changes a final symlink itself. */
  readonly chown: (path: string, uid: number, gid: number, follow: boolean) => Effect.Effect<void, NotFound | Failed>
  /** Sets access and modification times; `follow: false` changes a final symlink itself. */
  readonly utimes: (
    path: string,
    atimeMs: number,
    mtimeMs: number,
    follow: boolean,
  ) => Effect.Effect<void, NotFound | Failed>
  /** Creates a symlink at `path` holding `target` as given. */
  readonly symlink: (target: string, path: string) => Effect.Effect<void, Failed>
  /** The target a symlink holds; `WrongKind` for anything else. */
  readonly readlink: (path: string) => Effect.Effect<string, NotFound | WrongKind | Failed>
  /** The canonical absolute path with every symlink resolved. */
  readonly realpath: (path: string) => Effect.Effect<string, NotFound | Failed>
  /** Creates a hard link at `path` to the file at `existing`. */
  readonly link: (existing: string, path: string) => Effect.Effect<void, NotFound | Failed>
  readonly statfs: (path: string) => Effect.Effect<FilesystemInfo, NotFound | Failed>
}

export interface Files extends FilesImpl {}

/**
 * Derives a follow-stat kind from the lstat-like Files contract. A dangling
 * symlink fails with `NotFound`.
 */
export const typeFollowing = (files: Files, path: string) =>
  files.stat(path).pipe(
    Effect.flatMap((info) =>
      info.type === "symlink"
        ? files.read(path, { offset: 0, length: 0 }).pipe(
            Effect.map((result) => result.info.type),
            Effect.catchTag("Environment.WrongKind", (error) => Effect.succeed(error.actual)),
          )
        : Effect.succeed(info.type),
    ),
  )

/** Follows a final symlink, so a dangling symlink does not exist. */
export const exists = (files: Files, path: string) =>
  typeFollowing(files, path).pipe(
    Effect.as(true),
    Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
  )

export * as EnvironmentFiles from "./files.js"
