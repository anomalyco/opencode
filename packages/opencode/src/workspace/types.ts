import type { Effect, Scope, Sink, Stream } from "effect"
import { Workspace as WorkspaceErrors } from "./errors"

export namespace Workspace {
  export type FileType = "file" | "directory" | "symlink" | "other"

  export interface FileInfo {
    readonly type: FileType
    readonly size: number
    readonly mtime: Date | null
  }

  export interface DirEntry {
    readonly name: string
    readonly type: FileType
  }

  export interface ExecOpts {
    readonly cwd?: string
    readonly env?: Record<string, string>
    readonly timeoutMs?: number
    readonly signal?: AbortSignal
    readonly stdin?: Uint8Array | string
  }

  export interface ExecResult {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
  }

  export interface ExecStreamHandle {
    readonly stdin: Sink.Sink<void, Uint8Array, never, WorkspaceErrors.BackendError>
    readonly stdout: Stream.Stream<Uint8Array, WorkspaceErrors.BackendError>
    readonly stderr: Stream.Stream<Uint8Array, WorkspaceErrors.BackendError>
    readonly all: Stream.Stream<Uint8Array, WorkspaceErrors.BackendError>
    readonly exitCode: Effect.Effect<number | null, WorkspaceErrors.BackendError>
    readonly kill: Effect.Effect<void>
  }

  export type FsEventType = "add" | "change" | "unlink"
  export interface FsEvent {
    readonly type: FsEventType
    readonly path: string
  }

  export interface WatchOpts {
    /** Path patterns the backend should not emit events for. */
    readonly ignore?: ReadonlyArray<string>
  }

  export interface Backend {
    /** Opaque identifier. Callers MUST NOT parse this. */
    readonly id: string

    /** Absolute workspace root in the backend's own filesystem. */
    readonly rootPath: string

    /**
     * Absolute path to the shell the backend wants callers to use for
     * `execStream` / `exec`. Cross-substrate flows (macOS host → Linux
     * sandbox) read this instead of `process.env.SHELL` so we don't try
     * to spawn `/bin/zsh` in an image that only has `/bin/bash`.
     */
    readonly shell: string

    readonly stat: (path: string) => Effect.Effect<FileInfo, WorkspaceErrors.BackendError>
    readonly exists: (path: string) => Effect.Effect<boolean, WorkspaceErrors.BackendError>
    readonly readFile: (path: string) => Effect.Effect<Uint8Array, WorkspaceErrors.BackendError>
    /** Raw write. Does NOT create parent directories. */
    readonly writeFile: (path: string, data: Uint8Array) => Effect.Effect<void, WorkspaceErrors.BackendError>
    readonly mkDir: (
      path: string,
      opts: { readonly recursive: boolean },
    ) => Effect.Effect<void, WorkspaceErrors.BackendError>
    readonly readDir: (path: string) => Effect.Effect<DirEntry[], WorkspaceErrors.BackendError>
    readonly remove: (
      path: string,
      opts: { readonly recursive: boolean },
    ) => Effect.Effect<void, WorkspaceErrors.BackendError>
    readonly rename: (from: string, to: string) => Effect.Effect<void, WorkspaceErrors.BackendError>

    readonly exec: (
      cmd: string,
      args: string[],
      opts?: ExecOpts,
    ) => Effect.Effect<ExecResult, WorkspaceErrors.BackendError>

    readonly execStream: (
      cmd: string,
      args: string[],
      opts?: ExecOpts,
    ) => Effect.Effect<ExecStreamHandle, WorkspaceErrors.BackendError, Scope.Scope>

    readonly watch: (path: string, opts?: WatchOpts) => Stream.Stream<FsEvent, WorkspaceErrors.BackendError>

    readonly close: Effect.Effect<void>
  }
}
