import path from "path"
import { Effect, Layer, Record, Result, Schema, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new Auth.AuthError({ message, cause })

export namespace Auth {
  export class Oauth extends Schema.Class<Oauth>("OAuth")({
    type: Schema.Literal("oauth"),
    refresh: Schema.String,
    access: Schema.String,
    expires: Schema.Number,
    accountId: Schema.optional(Schema.String),
    enterpriseUrl: Schema.optional(Schema.String),
  }) {}

  export class Api extends Schema.Class<Api>("ApiAuth")({
    type: Schema.Literal("api"),
    key: Schema.String,
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
      const decode = Schema.decodeUnknownOption(Info)

      const all = Effect.fn("Auth.all")(() =>
        Effect.tryPromise({
          try: async () => {
            const data = await Filesystem.readJson<Record<string, unknown>>(file).catch(() => ({}))
            return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
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

  const { runPromise } = makeRuntime(Service, layer)

  export async function get(providerID: string) {
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }

  export async function urls(): Promise<string[]> {
    const data = await all()
    return Object.entries(data)
      .filter(([, value]) => value.type === "wellknown")
      .map(([key]) => key)
  }

  const WellKnownConfig = z.object({
    auth: z.object({
      command: z.array(z.string()),
      env: z.string(),
    }),
  })

  export async function wellknown(url: string) {
    const normalized = url.replace(/\/+$/, "")
    const response = await fetch(`${normalized}/.well-known/opencode`)
    if (!response.ok) {
      throw new Error(`failed to fetch well-known config from ${normalized}: ${response.status}`)
    }
    const parsed = WellKnownConfig.safeParse(await response.json())
    if (!parsed.success) {
      throw new Error(`invalid well-known config from ${normalized}: ${parsed.error.message}`)
    }
    const proc = Bun.spawn({
      cmd: parsed.data.auth.command,
      stdout: "pipe",
      stderr: "pipe",
    })
    const exit = await proc.exited
    if (exit !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`auth command failed with exit code ${exit}${stderr ? ": " + stderr.trim() : ""}`)
    }
    const token = await new Response(proc.stdout).text()
    await set(normalized, {
      type: "wellknown",
      key: parsed.data.auth.env,
      token: token.trim(),
    })
  }
}
