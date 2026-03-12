import { Effect, Layer, ServiceMap } from "effect"
import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { filter, fromEntries, map, mapValues, pipe } from "remeda"
import type { AuthOuathResult } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import * as Auth from "@/auth/service"
import * as ScopedState from "@/util/scoped-state"
import { ProviderID } from "./schema"
import z from "zod"

export type Method = {
  type: "oauth" | "api"
  label: string
}

export type Authorization = {
  url: string
  method: "auto" | "code"
  instructions: string
}

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

export namespace ProviderAuthService {
  export interface Service {
    readonly methods: () => Effect.Effect<Record<string, Method[]>>
    readonly authorize: (input: { providerID: ProviderID; method: number }) => Effect.Effect<Authorization | undefined>
    readonly callback: (input: {
      providerID: ProviderID
      method: number
      code?: string
    }) => Effect.Effect<void, ProviderAuthError>
    readonly api: (input: { providerID: ProviderID; key: string }) => Effect.Effect<void, Auth.AuthServiceError>
  }
}

export class ProviderAuthService extends ServiceMap.Service<ProviderAuthService, ProviderAuthService.Service>()(
  "@opencode/ProviderAuth",
) {
  static readonly layer = Layer.effect(
    ProviderAuthService,
    Effect.gen(function* () {
      const auth = yield* Auth.AuthService
      const state = yield* ScopedState.make({
        root: () => Instance.directory,
        lookup: () =>
          Effect.promise(async () => {
            const methods = pipe(
              await Plugin.list(),
              filter((x) => x.auth?.provider !== undefined),
              map((x) => [x.auth!.provider, x.auth!] as const),
              fromEntries(),
            )
            return { methods, pending: {} as Record<string, AuthOuathResult> }
          }),
      })

      const methods = Effect.fn("ProviderAuthService.methods")(() =>
        ScopedState.get(state).pipe(
          Effect.map((x) =>
            mapValues(x.methods, (y) =>
              y.methods.map(
                (z): Method => ({
                  type: z.type,
                  label: z.label,
                }),
              ),
            ),
          ),
        ),
      )

      const authorize = Effect.fn("ProviderAuthService.authorize")(function* (input: {
        providerID: ProviderID
        method: number
      }) {
        const item = (yield* ScopedState.get(state)).methods[input.providerID]
        const method = item.methods[input.method]
        if (method.type !== "oauth") return
        const result = yield* Effect.promise(() => method.authorize())
        ;(yield* ScopedState.get(state)).pending[input.providerID] = result
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
        const match = (yield* ScopedState.get(state)).pending[input.providerID]
        if (!match) return yield* Effect.fail(new OauthMissing({ providerID: input.providerID }))

        const result =
          match.method === "code"
            ? yield* Effect.gen(function* () {
                const code = input.code
                if (!code) return yield* Effect.fail(new OauthCodeMissing({ providerID: input.providerID }))
                return yield* Effect.promise(() => match.callback(code))
              })
            : yield* Effect.promise(() => match.callback())

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

      const api = Effect.fn("ProviderAuthService.api")(function* (input: { providerID: ProviderID; key: string }) {
        yield* auth.set(input.providerID, {
          type: "api",
          key: input.key,
        })
      })

      return ProviderAuthService.of({
        methods,
        authorize,
        callback,
        api,
      })
    }),
  )

  static readonly defaultLayer = ProviderAuthService.layer.pipe(Layer.provide(Auth.AuthService.defaultLayer))
}
