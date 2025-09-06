import { Global } from "../global"
import { z } from "zod"
import { secrets } from "bun"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
    })
    .openapi({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .openapi({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .openapi({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).openapi({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const keychainName = "auth"

  export async function get(providerID: string): Promise<Info | undefined> {
    const data = await all()
    return data[providerID] as Info | undefined
  }

  export async function all(): Promise<Record<string, Info>> {
    const data = await secrets.get({ service: Global.keychainService, name: keychainName })
    return JSON.parse(data ?? "{}")
  }

  export async function set(key: string, info: Info) {
    Info.parse(info)
    const data = await all()
    data[key] = info
    await secrets.set({ service: Global.keychainService, name: keychainName, value: JSON.stringify(data) })
  }

  export async function remove(key: string) {
    const data = await all()
    delete data[key]
    await secrets.set({ service: Global.keychainService, name: keychainName, value: JSON.stringify(data) })
  }
}
