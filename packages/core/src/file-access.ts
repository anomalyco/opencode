export * as FileAccess from "./file-access.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Array, Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { Environment } from "./environment/index.js"
import { Flag } from "./flag.js"
import { Location } from "./location.js"
import { Machines } from "./machine/machines.js"
import { MachinePath } from "./machine/path.js"
import { Permission } from "./permission.js"
import { Project } from "./project.js"
import { AbsolutePath } from "./schema.js"
import type { SessionErrors } from "./session/error.js"
import type { Tool } from "./tool.js"

export const Kind = Schema.Literals(["file", "directory"])
export type Kind = typeof Kind.Type

/** Where a typed path points. */
export const Place = Schema.Struct({
  absolute: AbsolutePath,
  environment: Schema.Struct({ id: Environment.ID }),
})
export type Place = typeof Place.Type

export const ResolveInput = Schema.Struct({
  path: Schema.String,
  /** Selects the external approval boundary; it does not validate the target type. */
  kind: Kind.pipe(Schema.optional),
  /** The directory and machine the text was written in, for a path derived from an existing target. */
  base: Place.pipe(Schema.optional),
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
export const always = (target: Target) => (target.machine ? `${target.machine}:*` : "*")

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
  readonly locate: (path: string, base?: Place) => Effect.Effect<Place, Environment.Failed>
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
    const permission = yield* Permission.Service
    const flags = yield* Flag.Service
    const machines = yield* Machines.Service

    // The flag is read once per operation by `locate` and `resolve`, which both call this.
    const place = Effect.fnUntraced(function* (text: string, base: Place | undefined, enabled: boolean) {
      // Only text the model typed can name a machine: text derived from a target is a plain path on that target's
      // machine, and a shell there does not understand `gpu:`.
      const machine = !base && enabled ? MachinePath.parse(text) : undefined
      // A machine path is absolute or starts with ~/, so `gpu:work` is no machine path and would quietly be this
      // server's folder. Only a name that is a machine here is refused: another name stays a local folder, as before.
      if (!base && enabled) {
        const colon = text.indexOf(":")
        const name = text.slice(0, colon)
        const rest = text.slice(colon + 1)
        if (
          colon > 0 &&
          Schema.is(Machines.Name)(name) &&
          !rest.startsWith("/") &&
          !rest.startsWith("~") &&
          (yield* machines.list()).some((info) => info.id === name)
        )
          return yield* new Environment.Failed({
            path: text,
            cause: new MachinePath.NotAbsolute({ machine: Environment.ID.make(name) }),
          })
      }
      const id = machine?.machine ?? base?.environment.id ?? environment.id
      if (!machine && id === environment.id)
        return {
          absolute: AbsolutePath.make(resolvePath(base?.absolute ?? location.directory, text)),
          environment: { id },
        } satisfies Place
      // A machine's paths use POSIX rules rather than this server's, and `~` there is that machine's home, never this
      // server's. Only `~` and `~/` are read: another user's home or a shell's `~+` is not known here. With the flag
      // off no home is asked for, so a base on another machine refuses every `~`.
      const written = machine?.path ?? text
      const rooted =
        enabled && (written === "~" || written.startsWith("~/"))
          ? path.posix.join(
              yield* machines.home(id).pipe(Effect.mapError((cause) => new Environment.Failed({ path: text, cause }))),
              written.slice(1),
            )
          : written
      if (rooted.startsWith("~"))
        return yield* new Environment.Failed({ path: text, cause: new MachinePath.NotAbsolute({ machine: id }) })
      return {
        absolute: AbsolutePath.make(base ? path.posix.resolve(base.absolute, rooted) : path.posix.normalize(rooted)),
        environment: { id },
      } satisfies Place
    })

    const locate = Effect.fn("FileAccess.locate")(function* (text: string, base?: Place) {
      const enabled = yield* flags.enabled("machines")
      return yield* place(text, base, enabled)
    })

    const resolve = Effect.fn("FileAccess.resolve")(function* (input: ResolveInput) {
      const enabled = yield* flags.enabled("machines")
      const located = yield* place(input.path, input.base, enabled)
      // A machine path is another machine's absolute path: it is never internal to this Location and never this server's.
      if (located.environment.id !== environment.id) return yield* machineTarget(located, input.kind)
      const absolute = located.absolute
      const worktree = path.resolve(location.project.directory)
      const internal =
        FSUtil.contains(location.directory, absolute) ||
        (worktree !== path.parse(worktree).root && FSUtil.contains(worktree, absolute))
      if (internal) {
        const relative = slash(path.relative(location.directory, absolute) || ".")
        return {
          absolute,
          // With machines on, a local folder can be named like a machine path; `./` keeps its permission name its own.
          resource: enabled && MachinePath.parse(relative) ? `./${relative}` : relative,
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

    // A machine path is always external, and its resources carry the machine name so its rules never settle a local
    // path's. Type detection runs over the machine's own files; a saved rule is the directory's own glob, which is
    // what was shown, rather than a search upward from this server's platform.
    const machineTarget = Effect.fnUntraced(function* (place: Place, kind: Kind | undefined) {
      const machineEnvironment = yield* machines
        .get(place.environment.id)
        .pipe(Effect.mapError((cause) => new Environment.Failed({ path: place.absolute, cause })))
      const type =
        kind ??
        (yield* Environment.typeFollowing(machineEnvironment.files, place.absolute).pipe(
          Effect.catchTag("Environment.NotFound", () => Effect.undefined),
        ))
      const directory = AbsolutePath.make(type === "directory" ? place.absolute : path.posix.dirname(place.absolute))
      const prefix = `${place.environment.id}:`
      return {
        absolute: place.absolute,
        resource: `${prefix}${place.absolute}`,
        externalDirectory: {
          action: "external_directory",
          directory,
          resource: `${prefix}${path.posix.join(directory, "*")}`,
          save: `${prefix}${path.posix.join(directory, "*")}`,
        },
        environment: machineEnvironment,
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
      const base =
        options === undefined || options.siblingOf.environment.id === environment.id
          ? undefined
          : {
              absolute: AbsolutePath.make(path.dirname(options.siblingOf.absolute)),
              environment: options.siblingOf.environment,
            }
      const target = yield* resolve({ path: file, base, kind: options ? "file" : undefined })
      const sibling =
        options !== undefined &&
        target.environment.id === options.siblingOf.environment.id &&
        path.dirname(target.absolute) === path.dirname(options.siblingOf.absolute)

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
  deps: [Environment.node, Flag.node, Location.node, Machines.node, Permission.node],
})
