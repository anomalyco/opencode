import path from "path"
import { Global } from "../global"
import z from "zod"

export const OAUTH_DUMMY_KEY = "ohmycode-oauth-dummy-key"

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

  const filepath = path.join(Global.Path.data, "auth.json")
  const legacyFilepath = path.join(Global.Path.legacy.data, "auth.json")

  function parse(input: Record<string, unknown>) {
    return Object.entries(input).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  async function local() {
    return parse(
      await Bun.file(filepath)
        .json()
        .catch(() => ({}) as Record<string, unknown>),
    )
  }

  async function legacy() {
    return parse(
      await Bun.file(legacyFilepath)
        .json()
        .catch(() => ({}) as Record<string, unknown>),
    )
  }

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    return {
      ...(await legacy()),
      ...(await local()),
    }
  }

  export async function set(key: string, info: Info) {
    const file = Bun.file(filepath)
    const data = await local()
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2), { mode: 0o600 })
  }

  export async function remove(key: string) {
    const file = Bun.file(filepath)
    const data = await local()
    delete data[key]
    await Bun.write(file, JSON.stringify(data, null, 2), { mode: 0o600 })
  }
}
