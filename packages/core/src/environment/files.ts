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
  readonly read: (
    path: string,
    range?: { readonly offset: number; readonly length: number },
  ) => Effect.Effect<{ readonly info: FileInfo; readonly bytes: Uint8Array }, NotFound | WrongKind | Failed>
  readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void, Failed>
  readonly stat: (path: string) => Effect.Effect<FileInfo, NotFound | Failed>
  readonly list: (path: string) => Effect.Effect<ReadonlyArray<DirEntry>, NotFound | WrongKind | Failed>
  readonly remove: (path: string) => Effect.Effect<void, Failed>
  readonly move: (from: string, to: string) => Effect.Effect<void, NotFound | Failed>
  readonly mkdir: (path: string) => Effect.Effect<void, Failed>
}

export interface Files extends FilesImpl {}

export * as EnvironmentFiles from "./files"
