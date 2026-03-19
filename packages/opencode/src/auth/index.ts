import { Effect } from "effect"
import z from "zod"
import { runtime } from "@/effect/runtime"
import * as S from "./effect"

export { OAUTH_DUMMY_KEY } from "./effect"

function runPromise<A>(f: (service: S.AuthEffect.Interface) => Effect.Effect<A, S.AuthError>) {
  return runtime.runPromise(S.AuthEffect.Service.use(f))
}

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
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }

  export async function urls(): Promise<string[]> {
    const data = await all()
    return Object.entries(data)
      .filter(([, value]) => value.type === "wellknown")
      .map(([key]) => key)
  }

  const WellKnownConfig = z.object({
    auth: z.object({
      command: z.array(z.string()),
      env: z.string(),
    }),
  })

  export async function wellknown(url: string) {
    const normalized = url.replace(/\/+$/, "")
    const response = await fetch(`${normalized}/.well-known/opencode`)
    if (!response.ok) {
      throw new Error(`failed to fetch well-known config from ${normalized}: ${response.status}`)
    }
    const parsed = WellKnownConfig.safeParse(await response.json())
    if (!parsed.success) {
      throw new Error(`invalid well-known config from ${normalized}: ${parsed.error.message}`)
    }
    const proc = Bun.spawn({
      cmd: parsed.data.auth.command,
      stdout: "pipe",
      stderr: "pipe",
    })
    const exit = await proc.exited
    if (exit !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`auth command failed with exit code ${exit}${stderr ? ": " + stderr.trim() : ""}`)
    }
    const token = await new Response(proc.stdout).text()
    await set(normalized, {
      type: "wellknown",
      key: parsed.data.auth.env,
      token: token.trim(),
    })
  }
}
