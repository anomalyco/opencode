import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import { authSchema, type Auth as AuthType } from "@generated/validators/auth"
import { oauthSchema, type Oauth as OauthType } from "@generated/validators/oauth"
import { apiAuthSchema, type ApiAuth as ApiAuthType } from "@generated/validators/apiAuth"
import { wellKnownAuthSchema, type WellKnownAuth as WellKnownAuthType } from "@generated/validators/wellKnownAuth"

export namespace Auth {
  // Generated from JSON Schema - see schema/oauth.schema.json
  export const Oauth = oauthSchema
  export type Oauth = OauthType

  // Generated from JSON Schema - see schema/apiAuth.schema.json
  export const Api = apiAuthSchema
  export type Api = ApiAuthType

  // Generated from JSON Schema - see schema/wellKnownAuth.schema.json
  export const WellKnown = wellKnownAuthSchema
  export type WellKnown = WellKnownAuthType

  // Generated from JSON Schema - see schema/auth.schema.json
  export const Info = authSchema
  export type Info = AuthType

  const filepath = path.join(Global.Path.data, "auth.json")

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  export async function all(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  export async function set(key: string, info: Info) {
    const file = Bun.file(filepath)
    const data = await all()
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function remove(key: string) {
    const file = Bun.file(filepath)
    const data = await all()
    delete data[key]
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }
}
