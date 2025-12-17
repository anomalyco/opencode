import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult, Hooks } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import { Auth } from "@/auth"
import { ProviderAuthRegistry } from "@/provider-auth/registry"
import { CredentialStore, CredentialsMigrate } from "@/credentials"
import { Config } from "@/config/config"

export namespace ProviderAuth {
  function dedupeMethods(methods: NonNullable<Hooks["auth"]>["methods"]): NonNullable<Hooks["auth"]>["methods"] {
    const seen = new Set<string>()
    const out: typeof methods = []
    for (const method of methods) {
      const key = `${method.type}:${method.label}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(method)
    }
    return out
  }

  const state = Instance.state(async () => {
    const pluginMethods = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )

    const methods: Record<string, NonNullable<Hooks["auth"]>> = { ...pluginMethods }
    for (const providerId of ProviderAuthRegistry.listProviderIds()) {
      const core = ProviderAuthRegistry.getAuthHook(providerId)
      if (!core) continue
      const existing = methods[providerId]
      if (!existing) {
        methods[providerId] = core as NonNullable<Hooks["auth"]>
        continue
      }
      // Merge methods, preferring core methods first.
      const merged = dedupeMethods([...core.methods, ...existing.methods])
      methods[providerId] = {
        ...existing,
        methods: merged,
      }
    }

    for (const providerId of Object.keys(methods)) {
      const methodList = methods[providerId]?.methods ?? []
      const hasApi = methodList.some((m) => m.type === "api")
      if (!hasApi) {
        methodList.push({
          type: "api",
          label: "API key",
        } as any)
      }
      methods[providerId] = { ...methods[providerId]!, methods: methodList }
    }

    return { methods, pending: {} as Record<string, AuthOuathResult> }
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
    }),
    async (input): Promise<Authorization | undefined> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      const method = auth.methods[input.method]
      if (method.type === "oauth") {
        const result = await method.authorize()
        await state().then((s) => (s.pending[input.providerID] = result))
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
    }),
    async (input) => {
      const match = await state().then((s) => s.pending[input.providerID])
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
          await Auth.set(input.providerID, {
            type: "api",
            key: result.key,
          })
        }
        if ("refresh" in result) {
          await CredentialsMigrate.migrateIfNeeded()
          const config = await Config.get()
          const namespace = config.provider?.[input.providerID]?.auth?.namespace ?? "default"
          const existingOauth = (await CredentialStore.findByProvider(input.providerID, namespace)).filter(
            (r) => r.meta.kind === "oauth",
          )
          const hasDefault = existingOauth.some((r) => (r.meta.label ?? "") === "default")
          const label = hasDefault ? `${input.providerID}-${new Date().toISOString()}` : "default"
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
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
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
