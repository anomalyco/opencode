import path from "path"
import { Effect, Layer, Record, Result, Schema, ServiceMap } from "effect"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import * as AuthSchema from "./schema"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export type Info = AuthSchema.Info

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export namespace AuthEffect {
  export interface Interface {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
    readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
    readonly remove: (key: string) => Effect.Effect<void, AuthError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Auth") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const all = Effect.fn("Auth.all")(() =>
        Effect.tryPromise({
          try: async () => {
            const data = await Filesystem.readJson<Record<string, unknown>>(file).catch(() => ({}))
            return Record.filterMap(data, (value) => {
              const parsed = AuthSchema.Info.safeParse(value)
              return parsed.success ? Result.succeed(parsed.data) : Result.failVoid
            })
          },
          catch: fail("Failed to read auth data"),
        }),
      )

      const get = Effect.fn("Auth.get")(function* (providerID: string) {
        return (yield* all())[providerID]
      })

      const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]
        yield* Effect.tryPromise({
          try: () => Filesystem.writeJson(file, { ...data, [norm]: info }, 0o600),
          catch: fail("Failed to write auth data"),
        })
      })

      const remove = Effect.fn("Auth.remove")(function* (key: string) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        delete data[key]
        delete data[norm]
        yield* Effect.tryPromise({
          try: () => Filesystem.writeJson(file, data, 0o600),
          catch: fail("Failed to write auth data"),
        })
      })

      return Service.of({ get, all, set, remove })
    }),
  )
}
