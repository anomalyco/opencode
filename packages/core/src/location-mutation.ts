export * as LocationMutation from "./location-mutation"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FSUtil } from "./fs-util"
import { Location } from "./location"

export const Kind = Schema.Literals(["file", "directory"])
export type Kind = typeof Kind.Type

/**
 * Mutation paths do not accept project references. Relative paths must stay
 * inside the active Location. Absolute paths outside it require separate
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
  reason: Schema.Literals([
    "relative_escape",
    "location_escape",
    "non_directory_ancestor",
    "unresolved_symlink",
    "location_identity_changed",
  ]),
}) {}

export class RevalidationError extends Schema.TaggedErrorClass<RevalidationError>()(
  "LocationMutation.RevalidationError",
  {
    path: Schema.String,
    reason: Schema.String,
  },
) {}

export interface Identity {
  /** Canonical path for this saved filesystem identity. */
  readonly canonical: string
  readonly dev: number
  readonly ino?: number
}

export interface ExternalDirectoryAuthorization {
  readonly action: "external_directory"
  /** Canonical existing directory used as the external approval boundary. */
  readonly directory: string
  /** `external_directory` permission resource. */
  readonly resource: string
  readonly save: string
  /** Saved identity checked again after approval to detect swaps. */
  readonly authority: Identity
}

/** Build the `external_directory` permission request. */
export const externalDirectoryPermission = (input: ExternalDirectoryAuthorization) => ({
  action: input.action,
  resources: [input.resource],
  save: [input.save],
})

export interface Target {
  /** Canonical existing path, or missing path below a canonical directory. */
  readonly canonical: string
  readonly exists: boolean
  readonly type?:
    | "File"
    | "Directory"
    | "SymbolicLink"
    | "BlockDevice"
    | "CharacterDevice"
    | "FIFO"
    | "Socket"
    | "Unknown"
  /** Permission resource: Location-relative for internal paths, canonical for external paths. */
  readonly resource: string
  readonly externalDirectory?: ExternalDirectoryAuthorization
}

/**
 * A path checked before permission approval.
 *
 *   resolve(path) -> Plan -> approve -> revalidate(plan) -> mutate immediately
 *
 * Tools must approve `target.externalDirectory`, when present, and their normal
 * mutation action before calling `revalidate`. Revalidation rejects escapes,
 * symlinks in missing suffixes, and changes made while approval is pending. It
 * cannot be atomic with the next filesystem call, so mutate immediately afterward.
 */
export interface Plan {
  readonly input: ResolveInput
  readonly target: Target
  /** Saved identity of the existing target or nearest existing ancestor. */
  readonly authority: Identity
}

export interface Interface {
  /**
   * Check a path before approval and derive its permission resources. Relative
   * paths must stay inside the Location. Absolute paths outside it require
   * separate `external_directory` approval. This does not approve the tool's
   * mutation action.
   */
  readonly resolve: (input: ResolveInput) => Effect.Effect<Plan, PathError | FSUtil.Error>
  /**
   * Check the plan again immediately before mutation. Reject changes to the
   * target, its saved identity, or approval resources. Mutate the returned
   * target immediately.
   */
  readonly revalidate: (plan: Plan) => Effect.Effect<Target, RevalidationError | FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/LocationMutation") {}

interface ResolvedPath {
  readonly canonical: string
  readonly exists: boolean
  readonly type?: Target["type"]
  readonly authority: Identity
}

const slash = (value: string) => value.replaceAll("\\", "/")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const locationRoot = yield* fs.realPath(location.directory)
    const locationAuthority = yield* identity(locationRoot)

    function identityFrom(canonical: string, info: Effect.Success<ReturnType<typeof fs.stat>>): Identity {
      return {
        canonical,
        dev: info.dev,
        ino: Option.getOrUndefined(info.ino),
      }
    }

    function identity(canonical: string) {
      return fs.stat(canonical).pipe(Effect.map((info) => identityFrom(canonical, info)))
    }

    function notFound<A>(effect: Effect.Effect<A, FSUtil.Error>) {
      return effect.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
    }

    function sameIdentity(left: Identity, right: Identity) {
      return left.canonical === right.canonical && left.dev === right.dev && left.ino === right.ino
    }

    /** Check whether a saved path still points to the same filesystem object. */
    const assertIdentity = Effect.fnUntraced(function* (expected: Identity) {
      const canonical = yield* notFound(fs.realPath(expected.canonical))
      if (canonical === undefined) return false
      const actual = yield* notFound(identity(canonical))
      if (actual === undefined) return false
      return canonical === expected.canonical && sameIdentity(expected, actual)
    })

    const assertLocationIdentity = Effect.fnUntraced(function* (requested: string) {
      if (yield* assertIdentity(locationAuthority)) return
      return yield* new PathError({ path: requested, reason: "location_identity_changed" })
    })

    const hasUnresolvedSymlink = Effect.fnUntraced(function* (anchor: string, suffix: string) {
      let current = anchor
      for (const part of suffix.split(path.sep)) {
        if (!part) continue
        current = path.join(current, part)
        if (
          yield* fs.readLink(current).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          )
        )
          return true
      }
      return false
    })

    /**
     * Resolve a path to a canonical target and save an existing filesystem
     * identity for later revalidation.
     *
     *   existing path -> save target identity
     *   missing path  -> save nearest existing directory identity
     *
     * Missing suffixes must not contain symlinks.
     */
    const resolvePath = Effect.fnUntraced(function* (absolute: string) {
      const existing = yield* notFound(fs.realPath(absolute))
      if (existing !== undefined) {
        const info = yield* fs.stat(existing)
        return {
          canonical: existing,
          exists: true,
          type: info.type,
          authority: identityFrom(existing, info),
        } satisfies ResolvedPath
      }

      let anchor = path.dirname(absolute)
      while (true) {
        const canonical = yield* notFound(fs.realPath(anchor))
        if (canonical !== undefined) {
          const info = yield* fs.stat(canonical)
          if (info.type !== "Directory")
            return yield* new PathError({ path: absolute, reason: "non_directory_ancestor" })
          const suffix = path.relative(anchor, absolute)
          if (yield* hasUnresolvedSymlink(anchor, suffix)) {
            return yield* new PathError({ path: absolute, reason: "unresolved_symlink" })
          }
          return {
            canonical: path.resolve(canonical, suffix),
            exists: false,
            authority: identityFrom(canonical, info),
          } satisfies ResolvedPath
        }
        const parent = path.dirname(anchor)
        if (parent === anchor) return yield* new PathError({ path: absolute, reason: "non_directory_ancestor" })
        anchor = parent
      }
    })

    /**
     * Choose the existing directory used for separate external approval.
     *
     *   existing directory target -> "<target>/*"
     *   file or missing target    -> "<nearest existing parent>/*"
     */
    const externalDirectory = Effect.fnUntraced(function* (resolved: ResolvedPath, kind: Kind) {
      const candidate =
        kind === "directory" && resolved.type === "Directory" ? resolved.canonical : path.dirname(resolved.canonical)
      const boundary = yield* resolvePath(candidate)
      const directory =
        boundary.exists && boundary.type === "Directory" ? boundary.canonical : boundary.authority.canonical
      const resource = slash(path.join(directory, "*"))
      return {
        action: "external_directory" as const,
        directory,
        resource,
        save: resource,
        authority: boundary.authority,
      }
    })

    const resolve = Effect.fn("LocationMutation.resolve")(function* (input: ResolveInput) {
      yield* assertLocationIdentity(input.path)
      const relative = !path.isAbsolute(input.path)
      const absolute = path.resolve(location.directory, input.path)
      const lexicallyInternal = FSUtil.contains(location.directory, absolute)
      if (relative && !lexicallyInternal) return yield* new PathError({ path: input.path, reason: "relative_escape" })

      const resolved = yield* resolvePath(absolute)
      if (lexicallyInternal && !FSUtil.contains(locationRoot, resolved.canonical)) {
        return yield* new PathError({ path: input.path, reason: "location_escape" })
      }

      const external = !lexicallyInternal
      const resource = external
        ? slash(resolved.canonical)
        : slash(path.relative(locationRoot, resolved.canonical) || ".")
      const target: Target = {
        canonical: resolved.canonical,
        exists: resolved.exists,
        type: resolved.type,
        resource,
        externalDirectory: external ? yield* externalDirectory(resolved, input.kind ?? "file") : undefined,
      }
      return { input, target, authority: resolved.authority } satisfies Plan
    })

    /**
     * Re-resolve a plan immediately before mutation and reject any changed
     * identity, target, or approval resource. This reduces the race window but
     * cannot make the next filesystem call atomic.
     */
    const revalidate = Effect.fn("LocationMutation.revalidate")(function* (plan: Plan) {
      const invalid = (reason: string) => new RevalidationError({ path: plan.input.path, reason })
      const fresh = yield* resolve(plan.input).pipe(
        Effect.mapError((error) => (error instanceof PathError ? invalid(error.reason) : error)),
      )
      if (!sameIdentity(fresh.authority, plan.authority)) return yield* invalid("mutation authority changed")
      if (fresh.target.canonical !== plan.target.canonical) return yield* invalid("canonical mutation target changed")
      if (fresh.target.resource !== plan.target.resource) return yield* invalid("mutation resource changed")
      if (Boolean(fresh.target.externalDirectory) !== Boolean(plan.target.externalDirectory)) {
        return yield* invalid("external directory authority changed")
      }
      if (
        fresh.target.externalDirectory &&
        plan.target.externalDirectory &&
        (fresh.target.externalDirectory.directory !== plan.target.externalDirectory.directory ||
          fresh.target.externalDirectory.resource !== plan.target.externalDirectory.resource ||
          !sameIdentity(fresh.target.externalDirectory.authority, plan.target.externalDirectory.authority))
      ) {
        return yield* invalid("external directory authority changed")
      }
      return fresh.target
    })

    return Service.of({ resolve, revalidate })
  }),
)

export const locationLayer = layer
