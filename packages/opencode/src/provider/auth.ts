import { Instance } from "@/project/instance"
import { mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult, Hooks } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import { ProviderAuthRegistry } from "@/provider-auth/registry"
import { CredentialStore, CredentialsMigrate } from "@/credentials"
import { Config } from "@/config/config"

export namespace ProviderAuth {
  const state = Instance.state(async () => {
    const methods: Record<string, NonNullable<Hooks["auth"]>> = {}
    for (const providerId of ProviderAuthRegistry.listProviderIds()) {
      const core = ProviderAuthRegistry.getAuthHook(providerId)
      if (!core) continue
      methods[providerId] = core as NonNullable<Hooks["auth"]>
    }

    return {
      methods,
      pending: {} as Record<
        string,
        {
          oauth: AuthOuathResult
          namespace?: string
          label?: string
        }
      >,
    }
  })

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state().then((x) => x.methods)
    return mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
        }),
      ),
    )
  }

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

  export const authorize = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      namespace: z.string().optional(),
      label: z.string().optional(),
    }),
    async (input): Promise<Authorization | undefined> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      if (!auth) return undefined
      const method = auth.methods[input.method]
      if (method.type === "oauth") {
        const result = await method.authorize()
        await state().then((s) => {
          s.pending[input.providerID] = {
            oauth: result,
            namespace: input.namespace,
            label: input.label,
          }
        })
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      }
    },
  )

  export const callback = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      code: z.string().optional(),
      namespace: z.string().optional(),
      label: z.string().optional(),
    }),
    async (input) => {
      const pending = await state().then((s) => s.pending[input.providerID])
      const match = pending?.oauth
      if (!match) throw new OauthMissing({ providerID: input.providerID })
      let result

      if (match.method === "code") {
        if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
        result = await match.callback(input.code)
      }

      if (match.method === "auto") {
        result = await match.callback()
      }

      if (result?.type === "success") {
        if ("key" in result) {
          await CredentialsMigrate.migrateIfNeeded()
          await CredentialStore.upsertSingleton({
            providerId: input.providerID,
            namespace: "default",
            kind: "api",
            label: "default",
            secret: { apiKey: result.key },
          })
        }
        if ("refresh" in result) {
          await CredentialsMigrate.migrateIfNeeded()
          const config = await Config.get()
          const namespace = (input.namespace ?? pending?.namespace ?? config.provider?.[input.providerID]?.auth?.namespace ?? "default")
            .trim() || "default"
          const desiredLabel = (input.label ?? pending?.label)?.trim()
          const existingOauth = (await CredentialStore.findByProvider(input.providerID, namespace)).filter(
            (r) => r.meta.kind === "oauth",
          )
          const existingLabels = new Set(existingOauth.map((r) => r.meta.label ?? ""))
          const labelBase = desiredLabel?.split("\n")[0]?.trim() || undefined

          const label = (() => {
            if (labelBase) {
              if (!existingLabels.has(labelBase)) return labelBase
              let n = 2
              while (existingLabels.has(`${labelBase}-${n}`)) n++
              return `${labelBase}-${n}`
            }

            const hasDefault = existingLabels.has("default")
            return hasDefault ? `${input.providerID}-${new Date().toISOString()}` : "default"
          })()

          const { type: _, provider: __, access, refresh, expires, ...extraFields } = result as any

          await CredentialStore.put({
            providerId: input.providerID,
            namespace,
            kind: "oauth",
            label,
            secret: {
              accessToken: access,
              refreshToken: refresh || undefined,
              expiresAt: expires || undefined,
              extra: Object.keys(extraFields).length > 0 ? extraFields : undefined,
            },
          })
        }
        await state().then((s) => delete s.pending[input.providerID])
        return
      }

      throw new OauthCallbackFailed({})
    },
  )

  export const api = fn(
    z.object({
      providerID: z.string(),
      key: z.string(),
    }),
    async (input) => {
      await CredentialsMigrate.migrateIfNeeded()
      await CredentialStore.upsertSingleton({
        providerId: input.providerID,
        namespace: "default",
        kind: "api",
        label: "default",
        secret: { apiKey: input.key },
      })
    },
  )

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
}
