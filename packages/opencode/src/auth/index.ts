import path from "path"
import { Effect, Layer, Record, Result, Schema, Context, Ref } from "effect"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")
const activeFile = path.join(Global.Path.data, "auth-active.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
  _accountLabel: Schema.optional(Schema.String),
  _accountEmail: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  _accountLabel: Schema.optional(Schema.String),
  _accountEmail: Schema.optional(Schema.String),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export const Info = Object.assign(_Info, { zod: zod(_Info) })
export type Info = Schema.Schema.Type<typeof _Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export type AccountEntry = {
  key: string
  label?: string
  email?: string
}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
  readonly accounts: (providerID: string) => Effect.Effect<AccountEntry[], AuthError>
  readonly active: (providerID: string) => Effect.Effect<string | undefined, AuthError>
  readonly activate: (providerID: string, accountKey: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Info)
    const writeMutex = yield* Ref.make(false)

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch (err) {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      const data = yield* all()
      return data[providerID]
    })

    const withWriteLock = <A, E>(eff: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        yield* Ref.updateAndWait(writeMutex, () => true)
        const result = yield* Effect.either(eff)
        yield* Ref.set(writeMutex, false)
        if (result._tag === "Left") return yield* Effect.fail(result.left)
        return result.right
      })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      yield* withWriteLock(
        Effect.gen(function* () {
          const norm = key.replace(/\/+$/, "")
          const data = yield* all()
          if (norm !== key) delete data[key]
          delete data[norm + "/"]
          yield* fsys
            .writeJson(file, { ...data, [norm]: info }, 0o600)
            .pipe(Effect.mapError(fail("Failed to write auth data")))
        }),
      )
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      yield* withWriteLock(
        Effect.gen(function* () {
          const norm = key.replace(/\/+$/, "")
          const data = yield* all()
          delete data[key]
          delete data[norm]
          yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
        }),
      )
    })

    const readActiveMap = Effect.fn("Auth.readActiveMap")(function* () {
      return (yield* fsys.readJson(activeFile).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, string>
    })

    const accounts = Effect.fn("Auth.accounts")(function* (providerID: string) {
      const data = yield* all()
      const entries: AccountEntry[] = []
      for (const [key, info] of Object.entries(data)) {
        if (key === providerID || key.startsWith(providerID + ":")) {
          entries.push({
            key,
            label: "_accountLabel" in info ? (info as { _accountLabel?: string })._accountLabel : undefined,
            email: "_accountEmail" in info ? (info as { _accountEmail?: string })._accountEmail : undefined,
          })
        }
      }
      return entries
    })

    const active = Effect.fn("Auth.active")(function* (providerID: string) {
      const map = yield* readActiveMap()
      return map[providerID] ?? providerID
    })

    const activate = Effect.fn("Auth.activate")(function* (providerID: string, accountKey: string) {
      const map = yield* readActiveMap()
      map[providerID] = accountKey
      yield* fsys
        .writeJson(activeFile, map, 0o600)
        .pipe(Effect.mapError(fail("Failed to write active account data")))
    })

    return Service.of({ get, all, set, remove, accounts, active, activate })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Auth from "."
