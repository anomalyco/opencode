export * as WorkspaceEnvironment from "./environment"

import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { makeLocationNode, tags } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Workspace } from "../workspace"
import { WorkspaceDriver } from "./driver"

export class Error extends Schema.TaggedErrorClass<Error>()("WorkspaceEnvironment.Error", {
  operation: Schema.String,
  path: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Distinct so callers (e.g. the LocationMutation ancestor walk) can catch absence. */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("WorkspaceEnvironment.NotFoundError", {
  path: Schema.String,
}) {}

/** Translate environment failures into the host filesystem error vocabulary. */
export const toFileSystemError =
  (method: string) =>
  (cause: Error | NotFoundError): FSUtil.Error =>
    new FSUtil.FileSystemError({ method, cause })

/**
 * Wrap one driver promise, translating the driver's not-found signal into the
 * environment error vocabulary so drivers and fakes never construct it ad hoc.
 */
export const tryOperation = <A>(input: {
  readonly operation: string
  readonly path: string
  readonly run: () => Promise<A>
  readonly isNotFound: (cause: unknown) => boolean
}): Effect.Effect<A, Error | NotFoundError> =>
  Effect.tryPromise({
    try: input.run,
    catch: (cause) =>
      input.isNotFound(cause)
        ? new NotFoundError({ path: input.path })
        : new Error({ operation: input.operation, path: input.path, cause }),
  })

export interface FileInfo {
  readonly type: FileSystem.File.Type
}

export interface DirectoryEntry {
  readonly name: string
  readonly type: "file" | "directory" | "symlink" | "other"
}

/**
 * The minimal primitive set the hosted implementations of Filesystem,
 * LocationMutation, and FileMutation consume. Grow it only when a real
 * consumer appears. Every method is one provider round trip: type mismatches
 * (read a directory, list a file) fail with Error instead of requiring a
 * stat pre-check.
 */
export interface Files {
  readonly stat: (path: string) => Effect.Effect<FileInfo, Error | NotFoundError>
  /** Canonical path with symlinks resolved; identity for permissions and locking. */
  readonly realPath: (path: string) => Effect.Effect<string, Error | NotFoundError>
  readonly read: (path: string) => Effect.Effect<Uint8Array, Error | NotFoundError>
  readonly list: (path: string) => Effect.Effect<readonly DirectoryEntry[], Error | NotFoundError>
  /** Creates parent directories, matching FSUtil.writeWithDirs. */
  readonly write: (path: string, content: Uint8Array) => Effect.Effect<void, Error>
  /** Removes one file. Removing a missing path fails with NotFoundError. */
  readonly remove: (path: string) => Effect.Effect<void, Error | NotFoundError>
}

export interface Shell {
  readonly executable: string
  readonly args: (command: string) => readonly string[]
  readonly environmentOverrides: Readonly<Record<string, string>>
  readonly detached: boolean
}

export interface Interface {
  /** The Workspace root, absolute in the provider filesystem. */
  readonly directory: string
  readonly files: Files
  readonly process: ChildProcessSpawner["Service"]
  readonly shell: Shell
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkspaceEnvironment") {}

/** NotFound becomes undefined; other environment failures become defects. */
export const optional = <A>(effect: Effect.Effect<A, Error | NotFoundError>): Effect.Effect<A | undefined> =>
  effect.pipe(
    Effect.catchTag("WorkspaceEnvironment.NotFoundError", () => Effect.succeed(undefined)),
    Effect.orDie,
  )

/** Present only in hosted Location graphs; local graphs never bind it. */
export const node = LayerNode.unbound(Service, tags.values.location)

/**
 * Connects on graph boot and stays connected for the graph's cached lifetime:
 * Layer.effect supplies the build scope, so releasing the LayerMap entry
 * closes the connection. It never stops or deletes the provider resource.
 */
export const hostedNode = (workspaceID: Workspace.ID) =>
  makeLocationNode({
    service: Service,
    // Connect failures during graph build are defects, matching the local
    // graph's E = never. Typed availability errors are a later design.
    layer: Layer.effect(
      Service,
      Effect.gen(function* () {
        const workspaces = yield* Workspace.Service
        const registry = yield* WorkspaceDriver.RegistryService
        const found = yield* workspaces.binding(workspaceID)
        const driver = yield* registry.get(found.provider)
        return yield* driver.connect(found.binding)
      }),
    ).pipe(Layer.orDie),
    deps: [Workspace.node, WorkspaceDriver.registryNode],
  })

/** Identity constructor so environment literals get contextual typing. */
export const make = (environment: Interface) => environment

/** Default lowering for Linux sandbox images. */
export const linuxShell: Shell = {
  executable: "/bin/bash",
  args: (command) => ["-c", command],
  environmentOverrides: {},
  detached: false,
}
