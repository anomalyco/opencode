export * as LocationMutation from "./location-mutation.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Location } from "./location.js"
import { Project } from "./project.js"
import { ProjectMarkers } from "./project/markers.js"
import { AbsolutePath } from "./schema.js"

export const Kind = Schema.Literals(["file", "directory"])
export type Kind = typeof Kind.Type

/**
 * Mutation paths do not accept project references. A leading `~` expands to
 * the home directory; other relative paths resolve from the active Location.
 * Paths outside it and its non-root project worktree require separate
 * `external_directory` approval.
 */
export const ResolveInput = Schema.Struct({
  path: Schema.String,
  /** Selects the external approval boundary; it does not validate the target type. */
  kind: Kind.pipe(Schema.optional),
})
export type ResolveInput = typeof ResolveInput.Type

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
  /** Absolute lexical path. */
  readonly absolute: string
  /** Permission resource: Location-relative for internal paths, absolute for external paths. */
  readonly resource: string
  readonly externalDirectory?: ExternalDirectoryAuthorization
}

export interface Interface {
  /**
   * Resolve a path and derive its permission resources. A leading `~` expands
   * to the home directory; other relative paths resolve from the Location.
   * Paths outside it and its non-root project worktree require separate
   * `external_directory` approval. This does not approve the mutation.
   */
  readonly resolve: (input: ResolveInput) => Effect.Effect<Target, FSUtil.Error>
}

/** Lexical absolute path, expanding a leading `~` before resolving against `directory`. */
export const resolvePath = (directory: string, input: string, home = Global.Path.home) =>
  path.resolve(
    directory,
    input === "~"
      ? home
      : input.startsWith("~/") || (process.platform === "win32" && input.startsWith("~\\"))
        ? path.join(home, input.slice(2))
        : input,
  )

export class Service extends Context.Service<Service, Interface>()("@opencode/LocationMutation") {}

const slash = (value: string) => value.replaceAll("\\", "/")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const markers = yield* ProjectMarkers.Service

    const resolve = Effect.fnUntraced(function* (input: ResolveInput) {
      const absolute = resolvePath(location.directory, input.path)
      const worktree = path.resolve(location.project.directory)
      const internal =
        FSUtil.contains(location.directory, absolute) ||
        (worktree !== path.parse(worktree).root && FSUtil.contains(worktree, absolute))
      if (internal) {
        return {
          absolute,
          resource: slash(path.relative(location.directory, absolute) || "."),
        } satisfies Target
      }
      const type =
        input.kind === "directory"
          ? "Directory"
          : input.kind === "file"
            ? "File"
            : (yield* fs.stat(absolute).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined)))
                ?.type
      const externalDirectory = type === "Directory" ? absolute : path.dirname(absolute)
      const externalResource = slash(path.join(externalDirectory, "*"))
      return {
        absolute,
        resource: slash(absolute),
        externalDirectory: {
          action: "external_directory",
          directory: externalDirectory,
          resource: externalResource,
          save: slash(
            path.join(
              (yield* Project.root(fs, AbsolutePath.make(externalDirectory), markers.targets())) ?? externalDirectory,
              "*",
            ),
          ),
        },
      } satisfies Target
    })

    return Service.of({ resolve })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [FSUtil.node, Location.node, ProjectMarkers.node],
})
