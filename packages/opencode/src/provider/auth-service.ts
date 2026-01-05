import type { AuthOuathResult } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import * as Auth from "@/auth/service"
import { ProviderID } from "./schema"
import { Effect, Layer, Record, ServiceMap } from "effect"
import { filter, fromEntries, map, pipe } from "remeda"
import z from "zod"

export const MethodPromptOption = z
  .object({
    label: z.string(),
    value: z.string(),
    hint: z.string().optional(),
  })
  .meta({
    ref: "ProviderAuthMethodPromptOption",
  })
export type MethodPromptOption = z.infer<typeof MethodPromptOption>

export const MethodPrompt = z
  .object({
    type: z.union([z.literal("select"), z.literal("text")]),
    key: z.string(),
    message: z.string(),
    placeholder: z.string().optional(),
    options: MethodPromptOption.array().optional(),
    conditional: z.string().optional(),
  })
  .meta({
    ref: "ProviderAuthMethodPrompt",
  })
export type MethodPrompt = z.infer<typeof MethodPrompt>

export const Method = z
  .object({
    type: z.union([z.literal("oauth"), z.literal("api")]),
    label: z.string(),
    prompts: MethodPrompt.array().optional(),
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

export const OauthMissing = NamedError.create(
  "ProviderAuthOauthMissing",
  z.object({
    providerID: ProviderID.zod,
  }),
)

export const OauthCodeMissing = NamedError.create(
  "ProviderAuthOauthCodeMissing",
  z.object({
    providerID: ProviderID.zod,
  }),
)

export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))

export type ProviderAuthError =
  | Auth.AuthServiceError
  | InstanceType<typeof OauthMissing>
  | InstanceType<typeof OauthCodeMissing>
  | InstanceType<typeof OauthCallbackFailed>

// Converts plugin condition functions to serializable "key:value" strings.
// Only handles simple `inputs.key === "value"` patterns. Complex conditions
// or minified/transpiled output may not match — plugins should prefer
// providing pre-serialized condition strings when possible.
export function serializeCondition(condition: unknown): string | undefined {
  if (typeof condition === "string") return condition
  if (typeof condition !== "function") return undefined
  const source = condition.toString()
  const match = source.match(/inputs\.(\w+)\s*===?\s*["'`]([^"'`]+)["'`]/)
  if (!match) {
    console.warn(`[ProviderAuth] Failed to serialize condition: ${source.slice(0, 100)}`)
    return undefined
  }
  return `${match[1]}:${match[2]}`
}

export namespace ProviderAuthService {
  export interface Service {
    readonly methods: () => Effect.Effect<Record<string, Method[]>>
    readonly authorize: (input: {
      providerID: ProviderID
      method: number
      inputs?: Record<string, string>
    }) => Effect.Effect<Authorization | undefined>
    readonly callback: (input: {
      providerID: ProviderID
      method: number
      code?: string
    }) => Effect.Effect<void, ProviderAuthError>
  }
}

export class ProviderAuthService extends ServiceMap.Service<ProviderAuthService, ProviderAuthService.Service>()(
  "@opencode/ProviderAuth",
) {
  static readonly layer = Layer.effect(
    ProviderAuthService,
    Effect.gen(function* () {
      const auth = yield* Auth.AuthService
      const hooks = yield* Effect.promise(async () => {
        const mod = await import("../plugin")
        return pipe(
          await mod.Plugin.list(),
          filter((x) => x.auth?.provider !== undefined),
          map((x) => [x.auth!.provider, x.auth!] as const),
          fromEntries(),
        )
      })
      const pending = new Map<ProviderID, AuthOuathResult>()

      const methods = Effect.fn("ProviderAuthService.methods")(function* () {
        return Record.map(hooks, (item) =>
          item.methods.map(
            (method): Method => ({
              type: method.type,
              label: method.label,
              prompts: method.prompts?.map(
                (p: {
                  type: string
                  key: string
                  message: string
                  placeholder?: string
                  options?: MethodPromptOption[]
                  condition?: unknown
                }): MethodPrompt => ({
                  type: p.type as "select" | "text",
                  key: p.key,
                  message: p.message,
                  placeholder: p.placeholder,
                  options: p.options,
                  conditional: serializeCondition(p.condition),
                }),
              ),
            }),
          ),
        )
      })

      const authorize = Effect.fn("ProviderAuthService.authorize")(function* (input: {
        providerID: ProviderID
        method: number
        inputs?: Record<string, string>
      }) {
        const method = hooks[input.providerID].methods[input.method]
        if (method.type !== "oauth") return
        const result = yield* Effect.promise(() => method.authorize(input.inputs ?? {}))
        pending.set(input.providerID, result)
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      })

      const callback = Effect.fn("ProviderAuthService.callback")(function* (input: {
        providerID: ProviderID
        method: number
        code?: string
      }) {
        const match = pending.get(input.providerID)
        if (!match) return yield* Effect.fail(new OauthMissing({ providerID: input.providerID }))
        if (match.method === "code" && !input.code)
          return yield* Effect.fail(new OauthCodeMissing({ providerID: input.providerID }))

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
          const { type: _, provider: _p, ...oauth } = result
          yield* auth.set(input.providerID, { type: "oauth", ...oauth })
        }
      })

      return ProviderAuthService.of({
        methods,
        authorize,
        callback,
      })
    }),
  )

  static readonly defaultLayer = ProviderAuthService.layer.pipe(Layer.provide(Auth.AuthService.defaultLayer))
}
