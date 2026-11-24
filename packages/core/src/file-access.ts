export * as FileAccess from "./file-access.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Array, Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { Environments } from "./environment/environments.js"
import { Environment } from "./environment/index.js"
import { EnvironmentPath } from "./environment/path.js"
import { Flag } from "./flag.js"
import { Location } from "./location.js"
import { Machines } from "./machine/machines.js"
import { Permission } from "./permission.js"
import { Project } from "./project.js"
import { AbsolutePath } from "./schema.js"
import type { SessionErrors } from "./session/error.js"
import type { Tool } from "./tool.js"
import { Workspace } from "./workspace.js"

export const Kind = Schema.Literals(["file", "directory"])
export type Kind = typeof Kind.Type

/** @deprecated Use Environment.Place. Removed in the next minor. */
export const Place = Environment.Place
/** @deprecated Use Environment.Place. Removed in the next minor. */
export type Place = Environment.Place

export const ResolveInput = Schema.Struct({
  path: Schema.String,
  /** Selects the external approval boundary; it does not validate the target type. */
  kind: Kind.pipe(Schema.optional),
  /** The directory and machine the text was written in, for a path derived from an existing target. */
  base: Environment.Place.pipe(Schema.optional),
})
export type ResolveInput = typeof ResolveInput.Type

export interface ExternalDirectoryAuthorization {
  readonly action: "external_directory"
  /** Lexical directory used as the external approval boundary. */
  readonly directory: AbsolutePath
  readonly resource: string
  readonly save: string
}

export interface Target {
  readonly absolute: AbsolutePath
  /** Location-relative for internal paths, absolute for external paths. */
  readonly resource: string
  readonly externalDirectory?: ExternalDirectoryAuthorization
  /** Where the target lives. Tools act on the target through this, not through a captured Environment. */
  readonly environment: Environment.Interface
  /** The machine the file is on, when it is not on this server. */
  readonly machine?: Environment.ID
}

export function externalDirectoryRequest(targets: readonly Target[]) {
  const external = Array.dedupeWith(
    targets.flatMap((target) => (target.externalDirectory ? [target.externalDirectory] : [])),
    (left, right) => left.resource === right.resource,
  )
  if (external.length === 0) return
  return {
    action: "external_directory",
    resources: external.map((item) => item.resource),
    save: external.map((item) => item.save),
  }
}

/**
 * Identifies a target's file: the same path in two environments is two files. The id's length comes first so no
 * id and path can read as another pair's key, and the keys of one environment sort as its paths do.
 */
export const key = (target: { readonly absolute: string; readonly environment: { readonly id: Environment.ID } }) =>
  `${target.environment.id.length}:${target.environment.id}:${target.absolute}`

/** The rule "always" saves for a file action: every file on the target's machine. */
export const always = (target: Target) => (target.machine ? EnvironmentPath.format(target.machine, "*") : "*")

export type Invocation = Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">

export interface ReadOptions {
  /** A target already authorized by this invocation, used for filename recovery. */
  readonly siblingOf: Target
}

export interface Interface {
  /**
   * Where a typed path points, from its text: no disk is touched and no machine is called. Only a path that starts at
   * a machine's home consults anything: the home in that machine's live hello, held in memory. It fails when the
   * machine is unknown or offline.
   */
  readonly locate: (path: string, base?: Environment.Place) => Effect.Effect<Environment.Place, Environment.Failed>
  /** Resolve a lexical path and its permission resources, without requesting approval. */
  readonly resolve: (input: ResolveInput) => Effect.Effect<Target, Environment.Failed>
  /** Approve external directories in one batch, preserving first-seen resource order. */
  readonly authorizeExternal: (
    targets: readonly Target[],
    context: Invocation,
    metadata?: Permission.AssertInput["metadata"],
  ) => Effect.Effect<void, Permission.Error | SessionErrors.NotFoundError>
  /** Resolve a read target and obtain external-directory approval before read approval. */
  readonly authorizeRead: (
    file: string,
    context: Invocation,
    options?: ReadOptions,
  ) => Effect.Effect<Target, Environment.Failed | Permission.Error | SessionErrors.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileAccess") {}

/** Expand a leading ~ and normalize Windows shell paths before lexical resolution. */
export const resolvePath = (directory: string, input: string, home = Global.Path.home) => {
  const normalized = FSUtil.windowsPath(input)
  return path.resolve(
    directory,
    normalized === "~"
      ? home
      : normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))
        ? path.join(home, normalized.slice(2))
        : normalized,
  )
}

const slash = (value: string) => value.replaceAll("\\", "/")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const exists = (file: string) => Environment.exists(environment.files, file)
    const location = yield* Location.Service
    const currentWorkingDirectory = yield* Environment.workingDirectoryResolver
    const permission = yield* Permission.Service
    const flags = yield* Flag.Service
    const environments = yield* Environments.Service
    const machines = yield* Machines.Service

    // The flag and the working directory are read once per operation by `locate` and `resolve`, which both call this.
    const place = Effect.fnUntraced(function* (
      text: string,
      base: Environment.Place | undefined,
      enabled: boolean,
      workingDirectory: Environment.Place,
    ) {
      // Only text the model typed on the server's own Location can address another environment: a sandboxed workspace
      // Location stays confined to its own environment and cannot escape to `local:/...`, paired machines, or other
      // sandboxes. Text derived from a target is always a plain path in that target's environment.
      const crossEnvironment = enabled && environment.id === Environment.localID
      const parsed =
        !base && crossEnvironment
          ? yield* EnvironmentPath.typed(text, machines).pipe(
              Effect.mapError((cause) => new Environment.Failed({ path: text, cause })),
            )
          : undefined
      const from = base ?? workingDirectory
      const id = parsed?.environment ?? from.environment.id
      // The host's path rules apply only to an environment without its own: a sandboxed Location's paths are POSIX even
      // on a Windows server, so they resolve below with its rules rather than becoming `C:\...` host paths.
      if (id === environment.id && !environment.path) {
        const written = parsed?.path ?? text
        const origin = parsed ? location.directory : from.absolute
        return {
          absolute: AbsolutePath.make(resolvePath(origin, written)),
          environment: { id },
        } satisfies Environment.Place
      }
      // Another environment's paths follow its own path rules (falling back to POSIX when unknown). Only `~` and `~/`
      // are expanded: paired machines report their home in hello, while sandboxes do not expose a home directory.
      // With the flag off no home is asked for, so a base on another machine refuses every `~`.
      const target = crossEnvironment
        ? yield* environments.lookup(id).pipe(
            Effect.catchTags({
              "Machines.NotFound": () => Effect.undefined,
              "Workspace.NotFound": () => Effect.undefined,
            }),
          )
        : undefined
      const rules = target ? (target.path ?? path) : path.posix
      const written = parsed?.path ?? text
      const isHome = written === "~" || written.startsWith("~/")
      const rooted =
        crossEnvironment && isHome && !Workspace.isID(id)
          ? rules.join(
              yield* machines.home(id).pipe(Effect.mapError((cause) => new Environment.Failed({ path: text, cause }))),
              written.slice(1),
            )
          : written
      if (rooted.startsWith("~"))
        return yield* new Environment.Failed({ path: text, cause: new EnvironmentPath.NotAbsolute({ machine: id }) })
      // A relative text is relative to the directory it was written in, which is the base when there is one and
      // otherwise the working directory itself: a session cwd in another environment is still a directory there.
      return {
        absolute: AbsolutePath.make(rules.resolve(from.absolute, rooted)),
        environment: { id },
      } satisfies Environment.Place
    })

    const locate = Effect.fn("FileAccess.locate")(function* (text: string, base?: Environment.Place) {
      const enabled = yield* flags.enabled("machines")
      return yield* place(text, base, enabled, yield* currentWorkingDirectory)
    })

    const resolve = Effect.fn("FileAccess.resolve")(function* (input: ResolveInput) {
      const enabled = yield* flags.enabled("machines")
      const workingDirectory = yield* currentWorkingDirectory
      const located = yield* place(input.path, input.base, enabled, workingDirectory)
      // A machine path is another machine's absolute path: it is never internal to this Location and never this server's.
      if (located.environment.id !== environment.id) {
        const rules = workingDirectory.environment.path ?? path
        const relative =
          located.environment.id === workingDirectory.environment.id
            ? rules.relative(workingDirectory.absolute, located.absolute)
            : undefined
        const inside =
          relative !== undefined &&
          relative !== ".." &&
          !relative.startsWith(`..${rules.sep}`) &&
          !rules.isAbsolute(relative)
        return yield* machineTarget(located, input.kind, inside)
      }
      const absolute = located.absolute
      const worktree = path.resolve(location.project.directory)
      // A path that is textually under a cwd on another machine is still this server's own.
      const internal =
        (located.environment.id === workingDirectory.environment.id &&
          FSUtil.contains(workingDirectory.absolute, absolute)) ||
        (worktree !== path.parse(worktree).root && FSUtil.contains(worktree, absolute))
      if (internal) {
        // The resource stays relative to the directory the path was written in; a cwd on another machine cannot name one.
        const base =
          located.environment.id === workingDirectory.environment.id ? workingDirectory.absolute : location.directory
        const relative = slash(path.relative(base, absolute) || ".")
        return {
          absolute,
          // With cross-environment prefixes on, a local folder can be named like an environment path, so keep it local.
          resource: enabled && environment.id === Environment.localID ? EnvironmentPath.local(relative) : relative,
          environment,
        } satisfies Target
      }
      const type =
        input.kind ??
        (yield* Environment.typeFollowing(environment.files, absolute).pipe(
          Effect.catchTag("Environment.NotFound", () => Effect.undefined),
        ))
      const directory = AbsolutePath.make(type === "directory" ? absolute : path.dirname(absolute))
      return {
        absolute,
        resource: slash(absolute),
        externalDirectory: {
          action: "external_directory",
          directory,
          resource: slash(path.join(directory, "*")),
          save: slash(path.join((yield* Project.root({ exists }, directory)) ?? directory, "*")),
        },
        environment,
      } satisfies Target
    })

    // A machine path carries the machine name in its resources so its rules never settle a local path's. It is
    // external unless it is inside the Session's own cwd there. Type detection runs over the machine's own files; a
    // saved rule is the directory's own glob, which is what was shown, rather than a search upward from this platform.
    const machineTarget = Effect.fnUntraced(function* (
      place: Environment.Place,
      kind: Kind | undefined,
      insideWorkingDirectory: boolean,
    ) {
      const targetEnvironment = yield* environments
        .lookup(place.environment.id)
        .pipe(Effect.mapError((cause) => new Environment.Failed({ path: place.absolute, cause })))
      const rules = targetEnvironment.path ?? path
      // Never wake a cold/lazy sandbox just to stat the approval boundary before permission is granted.
      const ready = yield* environments.ready(place.environment.id)
      const type =
        kind ??
        (ready
          ? yield* Environment.typeFollowing(targetEnvironment.files, place.absolute).pipe(
              Effect.catchTag("Environment.NotFound", () => Effect.undefined),
            )
          : undefined)
      // When a cold sandbox's target type is unknown, narrow the boundary to the path itself rather than widening
      // to its parent directory (which would save a wider rule such as `wrk_...:*` on "always").
      const narrowCold = !ready && type === undefined
      const directory = AbsolutePath.make(
        type === "directory" || narrowCold ? place.absolute : rules.dirname(place.absolute),
      )
      const contents = EnvironmentPath.format(
        place.environment.id,
        narrowCold ? place.absolute : rules.join(directory, "*"),
      )
      return {
        absolute: place.absolute,
        resource: EnvironmentPath.format(place.environment.id, place.absolute),
        ...(insideWorkingDirectory
          ? {}
          : { externalDirectory: { action: "external_directory", directory, resource: contents, save: contents } }),
        environment: targetEnvironment,
        machine: place.environment.id,
      } satisfies Target
    })

    const authorizeExternal = Effect.fn("FileAccess.authorizeExternal")(function* (
      targets: readonly Target[],
      context: Invocation,
      metadata?: Permission.AssertInput["metadata"],
    ) {
      const request = externalDirectoryRequest(targets)
      if (!request) return
      yield* permission.assert({
        ...request,
        ...(metadata === undefined ? {} : { metadata }),
        ...Permission.invocation(context),
      })
    })

    const authorizeRead = Effect.fn("FileAccess.authorizeRead")(function* (
      file: string,
      context: Invocation,
      options?: ReadOptions,
    ) {
      // A local sibling keeps the Location's resolution exactly as without recovery; a machine's candidate has no
      // Location to resolve against, so it takes the machine and the sibling's directory.
      const siblingPath = options?.siblingOf.environment.path ?? path
      const base =
        options === undefined || options.siblingOf.environment.id === environment.id
          ? undefined
          : {
              absolute: AbsolutePath.make(siblingPath.dirname(options.siblingOf.absolute)),
              environment: options.siblingOf.environment,
            }
      const target = yield* resolve({ path: file, base, kind: options ? "file" : undefined })
      const sibling =
        options !== undefined &&
        target.environment.id === options.siblingOf.environment.id &&
        (target.environment.path ?? path).dirname(target.absolute) === siblingPath.dirname(options.siblingOf.absolute)

      // Filename recovery shares the directory approval, but checks the recovered file's own read rules.
      if (!sibling) yield* authorizeExternal([target], context)
      yield* permission.assert({
        action: "read",
        resources: [target.resource],
        save: [always(target)],
        ...Permission.invocation(context),
      })
      return target
    })

    return Service.of({ locate, resolve, authorizeExternal, authorizeRead })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Environment.node, Environments.node, Flag.node, Location.node, Machines.node, Permission.node],
})
