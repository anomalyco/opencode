import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { isDeepStrictEqual } from "node:util"
import { Effect, Layer, Record, Result, Schema, Context, Option } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly getStored: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
  readonly compareAndSet: (
    providerID: string,
    expected: Info | undefined,
    next: Info,
  ) => Effect.Effect<{ written: boolean; current: Info | undefined }, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const flock = yield* EffectFlock.Service
    const decode = Schema.decodeUnknownOption(Info)
    const lockKey = "auth"

    const validate = Effect.fn("Auth.validate")(function* (info: Info) {
      const result = decode(info)
      if (Option.isNone(result))
        return yield* Effect.fail(new AuthError({ message: "Invalid auth data: credentials do not match the schema" }))
      return result.value
    })

    const readDisk = Effect.fn("Auth.readDisk")(function* () {
      const data = yield* fsys.readJson(file).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed({})),
        Effect.mapError(fail("Cannot safely write auth.json: failed to read or parse existing file")),
      )
      if (!data || typeof data !== "object" || Array.isArray(data))
        return yield* Effect.fail(new AuthError({ message: "Cannot safely write auth.json: expected a JSON object" }))
      return data as Record<string, unknown>
    })

    const read = Effect.fn("Auth.read")(function* () {
      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch (err) {}
      }

      return yield* read()
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const getStored = Effect.fn("Auth.getStored")(function* (providerID: string) {
      return (yield* read())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      yield* Effect.gen(function* () {
        const valid = yield* validate(info)
        const data = yield* readDisk()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]
        yield* fsys.writeJsonAtomic(file, { ...data, [norm]: valid }, 0o600)
      }).pipe(
        flock.withLock(lockKey),
        Effect.mapError((cause) => (cause instanceof AuthError ? cause : fail("Failed to write auth data")(cause))),
      )
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      yield* Effect.gen(function* () {
        const data = yield* readDisk()
        delete data[key]
        delete data[norm]
        yield* fsys.writeJsonAtomic(file, data, 0o600)
      }).pipe(
        flock.withLock(lockKey),
        Effect.mapError((cause) => (cause instanceof AuthError ? cause : fail("Failed to write auth data")(cause))),
      )
    })

    const compareAndSet = Effect.fn("Auth.compareAndSet")(function* (
      providerID: string,
      expected: Info | undefined,
      next: Info,
    ) {
      const norm = providerID.replace(/\/+$/, "")
      return yield* Effect.gen(function* () {
        const valid = yield* validate(next)
        const data = yield* readDisk()
        const current = Option.getOrUndefined(decode(data[norm]))
        if (
          (expected === undefined && Object.hasOwn(data, norm)) ||
          !isDeepStrictEqual(current && { ...current }, expected && { ...expected })
        )
          return { written: false, current }
        if (norm !== providerID) delete data[providerID]
        delete data[norm + "/"]
        yield* fsys.writeJsonAtomic(file, { ...data, [norm]: valid }, 0o600)
        return { written: true, current: valid }
      }).pipe(
        flock.withLock(lockKey),
        Effect.mapError((cause) => (cause instanceof AuthError ? cause : fail("Failed to write auth data")(cause))),
      )
    })

    return Service.of({ get, getStored, all, set, remove, compareAndSet })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, EffectFlock.node] })

export * as Auth from "."
