import { Effect, Schema } from "effect"

export const FileType = Schema.Literals(["file", "directory", "symlink", "other"])
export type FileType = typeof FileType.Type

export interface FileInfo {
  readonly type: FileType
  readonly size: number
  readonly mtimeMs: number
}

export interface DirEntry {
  readonly name: string
  readonly type: FileType
}

export class NotFound extends Schema.TaggedErrorClass<NotFound>()("Environment.NotFound", {
  path: Schema.String,
}) {}

export class WrongKind extends Schema.TaggedErrorClass<WrongKind>()("Environment.WrongKind", {
  path: Schema.String,
  actual: FileType,
}) {}

export class Failed extends Schema.TaggedErrorClass<Failed>()("Environment.Failed", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface FilesImpl {
  /**
   * Reads a file, following a final symlink so `info` describes the target whose bytes are returned.
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
  /** Lists a directory entry without following a final symlink; intermediate symlinks are traversed. */
  readonly list: (path: string) => Effect.Effect<ReadonlyArray<DirEntry>, NotFound | WrongKind | Failed>
  readonly remove: (path: string) => Effect.Effect<void, Failed>
  readonly move: (from: string, to: string) => Effect.Effect<void, NotFound | Failed>
  readonly mkdir: (path: string) => Effect.Effect<void, Failed>
}

export interface Files extends FilesImpl {}

export * as EnvironmentFiles from "./files"
