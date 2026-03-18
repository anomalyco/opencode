import type { AuthOuathResult } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import * as Auth from "@/auth/effect"
import { runPromiseInstance } from "@/effect/runtime"
import { fn } from "@/util/fn"
import { ProviderID } from "./schema"
import { Array as Arr, Effect, Layer, Record, Result, ServiceMap, Struct } from "effect"
import z from "zod"

export namespace ProviderAuth {
  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
      prompts: z
        .array(
          z.union([
            z.object({
              type: z.literal("text"),
              key: z.string(),
              message: z.string(),
              placeholder: z.string().optional(),
              when: z
                .object({
                  key: z.string(),
                  op: z.union([z.literal("eq"), z.literal("neq")]),
                  value: z.string(),
                })
                .optional(),
            }),
            z.object({
              type: z.literal("select"),
              key: z.string(),
              message: z.string(),
              options: z.array(
                z.object({
                  label: z.string(),
                  value: z.string(),
                  hint: z.string().optional(),
                }),
              ),
              when: z
                .object({
                  key: z.string(),
                  op: z.union([z.literal("eq"), z.literal("neq")]),
                  value: z.string(),
                })
                .optional(),
            }),
          ]),
        )
        .optional(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const OauthMissing = NamedError.create("ProviderAuthOauthMissing", z.object({ providerID: ProviderID.zod }))

  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({ providerID: ProviderID.zod }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))

  export const ValidationFailed = NamedError.create(
    "ProviderAuthValidationFailed",
    z.object({
      field: z.string(),
      message: z.string(),
    }),
  )

  export type Error =
    | Auth.AuthError
    | InstanceType<typeof OauthMissing>
    | InstanceType<typeof OauthCodeMissing>
    | InstanceType<typeof OauthCallbackFailed>
    | InstanceType<typeof ValidationFailed>

  export interface Interface {
    readonly methods: () => Effect.Effect<Record<ProviderID, Method[]>>
    readonly authorize: (input: {
      providerID: ProviderID
      method: number
      inputs?: Record<string, string>
    }) => Effect.Effect<Authorization | undefined, Error>
    readonly callback: (input: { providerID: ProviderID; method: number; code?: string }) => Effect.Effect<void, Error>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/ProviderAuth") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const auth = yield* Auth.AuthEffect.Service
      const hooks = yield* Effect.promise(async () => {
        const mod = await import("../plugin")
        const plugins = await mod.Plugin.list()
        return Record.fromEntries(
          Arr.filterMap(plugins, (x) =>
            x.auth?.provider !== undefined
              ? Result.succeed([ProviderID.make(x.auth.provider), x.auth] as const)
              : Result.failVoid,
          ),
        )
      })
      const pending = new Map<ProviderID, AuthOuathResult>()

      const methods = Effect.fn("ProviderAuth.methods")(function* () {
        return Record.map(hooks, (item) =>
          item.methods.map(
            (method): Method => ({
              type: method.type,
              label: method.label,
              prompts: method.prompts?.map((prompt) => {
                if (prompt.type === "select") {
                  return {
                    type: "select" as const,
                    key: prompt.key,
                    message: prompt.message,
                    options: prompt.options,
                    when: prompt.when,
                  }
                }
                return {
                  type: "text" as const,
                  key: prompt.key,
                  message: prompt.message,
                  placeholder: prompt.placeholder,
                  when: prompt.when,
                }
              }),
            }),
          ),
        )
      })

      const authorize = Effect.fn("ProviderAuth.authorize")(function* (input: {
        providerID: ProviderID
        method: number
        inputs?: Record<string, string>
      }) {
        const method = hooks[input.providerID].methods[input.method]
        if (method.type !== "oauth") return

        if (method.prompts && input.inputs) {
          for (const prompt of method.prompts) {
            if (prompt.type === "text" && prompt.validate && input.inputs[prompt.key] !== undefined) {
              const error = prompt.validate(input.inputs[prompt.key])
              if (error) return yield* Effect.fail(new ValidationFailed({ field: prompt.key, message: error }))
            }
          }
        }

        const result = yield* Effect.promise(() => method.authorize(input.inputs))
        pending.set(input.providerID, result)
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      })

      const callback = Effect.fn("ProviderAuth.callback")(function* (input: {
        providerID: ProviderID
        method: number
        code?: string
      }) {
        const match = pending.get(input.providerID)
        if (!match) return yield* Effect.fail(new OauthMissing({ providerID: input.providerID }))
        if (match.method === "code" && !input.code) {
          return yield* Effect.fail(new OauthCodeMissing({ providerID: input.providerID }))
        }

        const result = yield* Effect.promise(() =>
          match.method === "code" ? match.callback(input.code!) : match.callback(),
        )
        if (!result || result.type !== "success") return yield* Effect.fail(new OauthCallbackFailed({}))

        if ("key" in result) {
          yield* auth.set(input.providerID, {
            type: "api",
            key: result.key,
          })
        }

        if ("refresh" in result) {
          yield* auth.set(input.providerID, {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
            ...(result.accountId ? { accountId: result.accountId } : {}),
          })
        }
      })

      return Service.of({ methods, authorize, callback })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Auth.AuthEffect.layer))

  export async function methods() {
    return runPromiseInstance(Service.use((svc) => svc.methods()))
  }

  export const authorize = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input): Promise<Authorization | undefined> => runPromiseInstance(Service.use((svc) => svc.authorize(input))),
  )

  export const callback = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => runPromiseInstance(Service.use((svc) => svc.callback(input))),
  )
}
