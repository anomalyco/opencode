import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const PROFILE_DELIMITER = ":"
const PROFILE_REGEX = /^[a-zA-Z0-9_-]+$/

/** Parse composite key into provider and profile */
export function parseKey(key: string): { providerID: string; profile?: string } {
  const idx = key.indexOf(PROFILE_DELIMITER)
  if (idx === -1) return { providerID: key }
  return {
    providerID: key.slice(0, idx),
    profile: key.slice(idx + 1),
  }
}

/** Build composite key from provider and profile */
export function buildKey(providerID: string, profile?: string): string {
  if (!profile) return providerID
  return `${providerID}${PROFILE_DELIMITER}${profile}`
}

/** Validate profile name (alphanumeric, hyphen, underscore) */
export function validateProfileName(name: string): boolean {
  return PROFILE_REGEX.test(name)
}

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
  readonly get: (providerID: string, profile?: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (providerID: string, info: Info, profile?: string) => Effect.Effect<void, AuthError>
  readonly remove: (providerID: string, profile?: string) => Effect.Effect<void, AuthError>
  readonly profiles: (providerID: string) => Effect.Effect<Array<{ profile?: string; info: Info }>, AuthError>
  readonly hasDefault: (providerID: string) => Effect.Effect<boolean, AuthError>
  readonly setDefault: (providerID: string, profile: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch (err) {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string, profile?: string) {
      const key = buildKey(providerID, profile)
      return (yield* all())[key]
    })

    const set = Effect.fn("Auth.set")(function* (providerID: string, info: Info, profile?: string) {
      const key = buildKey(providerID, profile)
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (providerID: string, profile?: string) {
      const key = buildKey(providerID, profile)
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const profiles = Effect.fn("Auth.profiles")(function* (providerID: string) {
      const data = yield* all()
      const result: Array<{ profile?: string; info: Info }> = []
      for (const [key, info] of Object.entries(data)) {
        const parsed = parseKey(key)
        if (parsed.providerID === providerID) {
          result.push({ profile: parsed.profile, info })
        }
      }
      return result
    })

    const hasDefault = Effect.fn("Auth.hasDefault")(function* (providerID: string) {
      const data = yield* all()
      return providerID in data
    })

    const setDefault = Effect.fn("Auth.setDefault")(function* (providerID: string, profile: string) {
      const data = yield* all()
      const namedKey = buildKey(providerID, profile)
      const defaultKey = providerID

      const namedInfo = data[namedKey]
      if (!namedInfo) {
        return yield* new AuthError({ message: `Profile "${profile}" not found for provider "${providerID}"` })
      }

      const defaultInfo = data[defaultKey]

      // Swap: named becomes default, old default becomes named
      const newData = { ...data }
      newData[defaultKey] = namedInfo
      if (defaultInfo) {
        newData[namedKey] = defaultInfo
      } else {
        delete newData[namedKey]
      }
      yield* fsys.writeJson(file, newData, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    return Service.of({ get, all, set, remove, profiles, hasDefault, setDefault })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })

export * as Auth from "."
