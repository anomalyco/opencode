import path from "path"
import { Global } from "../global"
import z from "zod"
import { JsonStore } from "../util/json-store"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const store = JsonStore.create<Info>({
    path: () => path.join(Global.Path.data, "auth.json"),
    mode: 0o600,
    validate: (raw) => {
      const parsed = Info.safeParse(raw)
      return parsed.success ? parsed.data : undefined
    },
  })

  export async function get(providerID: string) {
    return store.get(providerID)
  }

  export async function all(): Promise<Record<string, Info>> {
    return store.all()
  }

  export async function set(key: string, info: Info) {
    return store.set(key, info)
  }

  export async function remove(key: string) {
    return store.remove(key)
  }
}
