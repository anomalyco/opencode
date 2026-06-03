export * as LocationMutation from "./location-mutation"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FSUtil } from "./fs-util"
import { Location } from "./location"

export const Kind = Schema.Literals(["file", "directory"])
export type Kind = typeof Kind.Type

/**
 * Mutation paths deliberately do not accept project references. References are
 * read-oriented aliases, while mutation authority starts at the active Location
 * or at an explicit absolute external path approved separately.
 */
export const ResolveInput = Schema.Struct({
  path: Schema.String,
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
  /** Canonical path whose filesystem identity anchors this authority. */
  readonly canonical: string
  readonly dev: number
  readonly ino?: number
}

export interface ExternalDirectoryAuthorization {
  readonly action: "external_directory"
  /** Canonical existing directory below which the external mutation is admitted. */
  readonly directory: string
  /** Permission resource suitable for a dedicated external_directory approval. */
  readonly resource: string
  readonly save: string
  /** Revalidated after approval so an approved external boundary cannot be swapped. */
  readonly authority: Identity
}

export interface Target {
  /** Lexically resolved path requested by the caller. */
  readonly absolute: string
  /** Canonical mutation path. Leaf tools should mutate this path after revalidation. */
  readonly canonical: string
  readonly exists: boolean
  readonly type?: "File" | "Directory" | "SymbolicLink" | "BlockDevice" | "CharacterDevice" | "FIFO" | "Socket" | "Unknown"
  /** Stable mutation-action resource: Location-relative internally, canonical externally. */
  readonly resource: string
  readonly externalDirectory?: ExternalDirectoryAuthorization
}

/**
 * A prospective mutation authority captured before permission prompts.
 *
 * Leaf tools should resolve a plan, approve `target.externalDirectory` when it
 * exists, perform their ordinary mutation-action approval, then call
 * `revalidate` immediately before mutating `target.canonical`. This two-phase
 * contract detects lexical escapes, symlink-ancestor escapes, and path-identity
 * swaps introduced while approval was pending. Filesystem path APIs cannot make
 * the final syscall atomic with revalidation, so leaf tools must not insert work
 * between revalidation and mutation.
 */
export interface Plan {
  readonly input: ResolveInput
  readonly target: Target
  /** Existing canonical target or ancestor that makes prospective creation safe. */
  readonly authority: Identity
}

export interface Interface {
  /** Resolve a mutation path without asserting leaf-tool permission policy. */
  readonly resolve: (input: ResolveInput) => Effect.Effect<Plan, PathError | FSUtil.Error>
  /** Re-prove a previously approved plan immediately before its leaf mutation. */
  readonly revalidate: (plan: Plan) => Effect.Effect<Target, RevalidationError | FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/LocationMutation") {}

interface ResolvedPath {
  readonly absolute: string
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

    function identity(canonical: string) {
      return fs.stat(canonical).pipe(
        Effect.map((info): Identity => ({
          canonical,
          dev: info.dev,
          ino: Option.getOrUndefined(info.ino),
        })),
      )
    }

    function notFound<A>(effect: Effect.Effect<A, FSUtil.Error>) {
      return effect.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
    }

    function sameIdentity(left: Identity, right: Identity) {
      return left.canonical === right.canonical && left.dev === right.dev && left.ino === right.ino
    }

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
        if (yield* fs.readLink(current).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))) return true
      }
      return false
    })

    const resolvePath = Effect.fnUntraced(function* (absolute: string) {
      const existing = yield* notFound(fs.realPath(absolute))
      if (existing !== undefined) {
        const info = yield* fs.stat(existing)
        return {
          absolute,
          canonical: existing,
          exists: true,
          type: info.type,
          authority: yield* identity(existing),
        } satisfies ResolvedPath
      }

      let anchor = path.dirname(absolute)
      while (true) {
        const canonical = yield* notFound(fs.realPath(anchor))
        if (canonical !== undefined) {
          const info = yield* fs.stat(canonical)
          if (info.type !== "Directory") return yield* new PathError({ path: absolute, reason: "non_directory_ancestor" })
          const suffix = path.relative(anchor, absolute)
          if (yield* hasUnresolvedSymlink(anchor, suffix)) {
            return yield* new PathError({ path: absolute, reason: "unresolved_symlink" })
          }
          return {
            absolute,
            canonical: path.resolve(canonical, suffix),
            exists: false,
            authority: yield* identity(canonical),
          } satisfies ResolvedPath
        }
        const parent = path.dirname(anchor)
        if (parent === anchor) return yield* new PathError({ path: absolute, reason: "non_directory_ancestor" })
        anchor = parent
      }
    })

    const externalDirectory = Effect.fnUntraced(function* (resolved: ResolvedPath, kind: Kind) {
      const candidate = kind === "directory" && resolved.type === "Directory" ? resolved.canonical : path.dirname(resolved.canonical)
      const boundary = yield* resolvePath(candidate)
      const directory = boundary.exists && boundary.type === "Directory" ? boundary.canonical : boundary.authority.canonical
      const authority = yield* identity(directory)
      const resource = slash(path.join(directory, "*"))
      return { action: "external_directory" as const, directory, resource, save: resource, authority }
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
      const resource = external ? slash(resolved.canonical) : slash(path.relative(locationRoot, resolved.canonical) || ".")
      const target: Target = {
        absolute,
        canonical: resolved.canonical,
        exists: resolved.exists,
        type: resolved.type,
        resource,
        externalDirectory: external ? yield* externalDirectory(resolved, input.kind ?? "file") : undefined,
      }
      return { input, target, authority: resolved.authority } satisfies Plan
    })

    const revalidate = Effect.fn("LocationMutation.revalidate")(function* (plan: Plan) {
      const invalid = (reason: string) => new RevalidationError({ path: plan.input.path, reason })
      if (!(yield* assertIdentity(plan.authority))) return yield* invalid("mutation authority identity changed")
      if (plan.target.externalDirectory && !(yield* assertIdentity(plan.target.externalDirectory.authority))) {
        return yield* invalid("external directory identity changed")
      }
      const fresh = yield* resolve(plan.input).pipe(
        Effect.mapError((error) => error instanceof PathError ? invalid(error.reason) : error),
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
