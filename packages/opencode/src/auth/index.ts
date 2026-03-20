import z from "zod"
import * as S from "./effect"

export { OAUTH_DUMMY_KEY } from "./effect"

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

  export async function get(providerID: string) {
    return S.AuthEffect.runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return S.AuthEffect.runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return S.AuthEffect.runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return S.AuthEffect.runPromise((service) => service.remove(key))
  }
}
