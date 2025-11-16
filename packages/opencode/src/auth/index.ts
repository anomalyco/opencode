import path from "path"
import { Global } from "../global"
import z from "zod"
import { NamedError } from "../util/error"
import { Log } from "../util/log"

export namespace Auth {
  const log = Log.create({ service: "auth" })

  export const CorruptedFileError = NamedError.create(
    "AuthCorruptedFileError",
    z.object({
      filepath: z.string(),
      message: z.string(),
    }),
  )

  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
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

  export async function get(providerID: string) {
    const data = await all()
    return data[providerID] as Info | undefined
  }

  export async function all(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    const exists = await file.exists()
    if (!exists) {
      return {}
    }

    try {
      return await file.json()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error("Failed to parse auth file", { filepath, error: errorMessage })
      throw new CorruptedFileError(
        { filepath, message: errorMessage },
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  export async function set(key: string, info: Info) {
    const data = await all()
    await Bun.write(filepath, JSON.stringify({ ...data, [key]: info }, null, 2), { mode: 0o600 })
  }

  export async function remove(key: string) {
    const data = await all()
    delete data[key]
    await Bun.write(filepath, JSON.stringify(data, null, 2), { mode: 0o600 })
  }
}
