export * as LocationMutation from "./location-mutation"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "./location"
import { Project } from "./project"
import { AbsolutePath } from "./schema"
import { WorkspaceEnvironment } from "./workspace/environment"

export const Kind = Schema.Literals(["file", "directory"])
export type Kind = typeof Kind.Type

/**
 * Mutation paths do not accept project references. Relative paths resolve
 * from the active Location. Paths outside it require separate
 * `external_directory` approval.
 */
export const ResolveInput = Schema.Struct({
  path: Schema.String,
  /** Selects the external approval boundary; it does not validate the target type. */
  kind: Kind.pipe(Schema.optional),
})
export type ResolveInput = typeof ResolveInput.Type

export class PathError extends Schema.TaggedErrorClass<PathError>()("LocationMutation.PathError", {
  path: Schema.String,
  reason: Schema.Literals(["non_directory_ancestor", "outside_workspace"]),
}) {}

export interface ExternalDirectoryAuthorization {
  readonly action: "external_directory"
  /** Lexical directory used as the external approval boundary. */
  readonly directory: string
  /** `external_directory` permission resource. */
  readonly resource: string
  readonly save: string
}

export const externalDirectoryPermission = (input: ExternalDirectoryAuthorization) => ({
  action: input.action,
  resources: [input.resource],
  save: [input.save],
})

export interface Target {
  /** Canonical existing path, or missing path below a canonical directory. */
  readonly canonical: string
  /**
   * Lexical resolved path before symlink canonicalization. Reads and writes
   * address the referent (canonical); entry operations like remove address
   * the name itself.
   */
  readonly absolute: string
  /** Permission resource: Location-relative for internal paths, lexical absolute for external paths. */
  readonly resource: string
  readonly externalDirectory?: ExternalDirectoryAuthorization
}

export interface Interface {
  /**
   * Resolve a path and derive its permission resources. Relative paths resolve
   * from the Location. Paths outside it require separate `external_directory`
   * approval. This does not approve the mutation.
   */
  readonly resolve: (input: ResolveInput) => Effect.Effect<Target, PathError | FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LocationMutation") {}

interface ResolvedPath {
  readonly canonical: string
  readonly type?:
    | "File"
    | "Directory"
    | "SymbolicLink"
    | "BlockDevice"
    | "CharacterDevice"
    | "FIFO"
    | "Socket"
    | "Unknown"
  readonly directory: string
  readonly lexicalDirectory: string
}

/**
 * Resolution primitives the shared ancestor walk uses; absence reports
 * undefined so the walk owns the missing-path vocabulary.
 */
interface WalkBackend<E> {
  readonly paths: Pick<path.PlatformPath, "dirname" | "resolve" | "relative">
  readonly realPathOptional: (path: string) => Effect.Effect<string | undefined, E>
  readonly statOptional: (path: string) => Effect.Effect<{ readonly type: ResolvedPath["type"] } | undefined, E>
}

/**
 * Canonicalize an existing path, or resolve a missing path below its nearest
 * existing ancestor directory.
 */
const resolvePathWith = <E>(backend: WalkBackend<E>) =>
  Effect.fnUntraced(function* (absolute: string) {
    const existing = yield* backend.realPathOptional(absolute)
    if (existing !== undefined) {
      const info = yield* backend.statOptional(existing)
      if (info === undefined) return yield* new PathError({ path: absolute, reason: "non_directory_ancestor" })
      return {
        canonical: existing,
        type: info.type,
        directory: info.type === "Directory" ? existing : backend.paths.dirname(existing),
        lexicalDirectory: info.type === "Directory" ? absolute : backend.paths.dirname(absolute),
      } satisfies ResolvedPath
    }

    let anchor = backend.paths.dirname(absolute)
    while (true) {
      const canonical = yield* backend.realPathOptional(anchor)
      if (canonical !== undefined) {
        const info = yield* backend.statOptional(canonical)
        if (info === undefined || info.type !== "Directory") {
          return yield* new PathError({ path: absolute, reason: "non_directory_ancestor" })
        }
        return {
          canonical: backend.paths.resolve(canonical, backend.paths.relative(anchor, absolute)),
          directory: canonical,
          lexicalDirectory: anchor,
        } satisfies ResolvedPath
      }
      const parent = backend.paths.dirname(anchor)
      if (parent === anchor) return yield* new PathError({ path: absolute, reason: "non_directory_ancestor" })
      anchor = parent
    }
  })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    function notFound<A>(effect: Effect.Effect<A, FSUtil.Error>) {
      return effect.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
    }

    const resolvePath = resolvePathWith({
      paths: path,
      realPathOptional: (target) => notFound(fs.realPath(target)),
      statOptional: (target) => notFound(fs.stat(target)),
    })

    const resolve = Effect.fn("LocationMutation.resolve")(function* (input: ResolveInput) {
      const absolute = path.resolve(location.directory, input.path)
      // External access follows the requested path boundary. Symlinks reached through an
      // internal path intentionally retain internal permission semantics after canonicalization.
      const lexicallyInternal = FSUtil.contains(location.directory, absolute)

      const resolved = yield* resolvePath(absolute)
      const external = !lexicallyInternal
      const resource = external
        ? FSUtil.slash(absolute)
        : FSUtil.slash(path.relative(location.directory, absolute) || ".")
      const externalDirectory = resolved.lexicalDirectory
      const externalResource = FSUtil.slash(path.join(externalDirectory, "*"))
      return {
        canonical: resolved.canonical,
        absolute,
        resource,
        externalDirectory: external
          ? {
              action: "external_directory",
              directory: externalDirectory,
              resource: externalResource,
              save: FSUtil.slash(
                path.join((yield* Project.root(fs, AbsolutePath.make(externalDirectory))) ?? externalDirectory, "*"),
              ),
            }
          : undefined,
      } satisfies Target
    })

    return Service.of({ resolve })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [FSUtil.node, Location.node],
})

// Mirrors the local resolve walk over WorkspaceEnvironment.Files with posix
// rules. Hosted paths are never external: everything outside the Location is
// rejected instead of routed to external_directory approval, because the
// approval boundary vocabulary is host-relative.
const hostedLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* WorkspaceEnvironment.Service
    const location = yield* Location.Service
    // Canonicalized even when the Location sits on the workspace root: the
    // environment does not guarantee a canonical directory (local fakes root
    // at symlinked temp paths).
    const root = yield* env.files.realPath(location.directory).pipe(Effect.orDie)

    const resolvePath = resolvePathWith({
      paths: path.posix,
      realPathOptional: (target) => WorkspaceEnvironment.optional(env.files.realPath(target)),
      statOptional: (target) => WorkspaceEnvironment.optional(env.files.stat(target)),
    })

    const resolve = Effect.fn("LocationMutation.resolve")(function* (input: ResolveInput) {
      const absolute = path.posix.resolve(location.directory, input.path)
      if (!FSUtil.containsPosix(location.directory, absolute))
        return yield* new PathError({ path: absolute, reason: "outside_workspace" })
      const resolved = yield* resolvePath(absolute)
      if (!FSUtil.containsPosix(root, resolved.canonical))
        return yield* new PathError({ path: absolute, reason: "outside_workspace" })
      return {
        canonical: resolved.canonical,
        absolute,
        resource: path.posix.relative(location.directory, absolute) || ".",
      } satisfies Target
    })

    return Service.of({ resolve })
  }),
)

export const hostedNode = makeLocationNode({
  service: Service,
  layer: hostedLayer.pipe(Layer.orDie),
  deps: [WorkspaceEnvironment.node, Location.node],
})
