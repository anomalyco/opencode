import { HostedUser } from "@/hosted/user"
import { Storage } from "@/storage/storage"
import { Context } from "@/util/context"
import { randomUUID } from "crypto"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { HTTPException } from "hono/http-exception"
import type { Context as HonoContext } from "hono"
import z from "zod"

export namespace HostedAuth {
  const COOKIE = "opencode_session"
  const TTL = 1000 * 60 * 60 * 24 * 30
  const context = Context.create<Value>("hosted-auth")

  type Value = {
    enabled: boolean
    trusted: boolean
    user: HostedUser.Info | undefined
    token: string | undefined
  }

  const Session = z.object({
    token: z.string(),
    user_id: HostedUser.Info.shape.id,
    time: z.object({
      created: z.number(),
      updated: z.number(),
      expires: z.number(),
    }),
  })
  type Session = z.output<typeof Session>

  function secure(c: HonoContext) {
    return new URL(c.req.url).protocol === "https:"
  }

  async function load(token: string | undefined) {
    const enabled = await HostedUser.enabled()
    if (!enabled || !token) {
      return {
        enabled,
        user: undefined,
        token,
      }
    }

    const session = await Storage.read<Session>(["hosted_session", token]).catch(() => undefined)
    if (!session) {
      return {
        enabled,
        user: undefined,
        token,
      }
    }

    if (session.time.expires <= Date.now()) {
      await Storage.remove(["hosted_session", token]).catch(() => undefined)
      return {
        enabled,
        user: undefined,
        token,
      }
    }

    const user = await HostedUser.get(session.user_id)
    if (!user || user.disabled) {
      await Storage.remove(["hosted_session", token]).catch(() => undefined)
      return {
        enabled,
        user: undefined,
        token,
      }
    }

    await Storage.update<Session>(["hosted_session", token], (draft) => {
      draft.time.updated = Date.now()
      draft.time.expires = Date.now() + TTL
    }).catch(() => undefined)

    return {
      enabled,
      user,
      token,
    }
  }

  export async function provide(c: HonoContext, fn: () => Promise<Response> | Response) {
    await HostedUser.bootstrap()
    const token = getCookie(c, COOKIE)
    const trusted = c.req.header("authorization")?.startsWith("Basic ") === true
    const result = await load(token)
    return context.provide(
      {
        ...result,
        trusted,
      },
      fn,
    )
  }

  function state() {
    return context.use()
  }

  export function enabled() {
    return state().enabled
  }

  export function trusted() {
    return state().trusted
  }

  export function optional() {
    return state().user
  }

  export function requireUser() {
    const user = optional()
    if (user) return user
    throw new HTTPException(401, { message: "Authentication required" })
  }

  export function requireAdmin() {
    const user = requireUser()
    if (user.role === "admin") return user
    throw new HTTPException(403, { message: "Admin access required" })
  }

  export function status() {
    return {
      enabled: enabled(),
      user: optional(),
    }
  }

  export async function login(c: HonoContext, input: { email: string; password: string }) {
    const user = await HostedUser.login(input)
    if (!user) throw new HTTPException(401, { message: "Invalid email or password" })

    const token = randomUUID()
    const now = Date.now()
    await Storage.write(["hosted_session", token], {
      token,
      user_id: user.id,
      time: {
        created: now,
        updated: now,
        expires: now + TTL,
      },
    })
    await HostedUser.touch(user.id)
    setCookie(c, COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: secure(c),
      maxAge: Math.floor(TTL / 1000),
    })
    return user
  }

  export async function logout(c: HonoContext) {
    const token = getCookie(c, COOKIE)
    if (token) await Storage.remove(["hosted_session", token]).catch(() => undefined)
    deleteCookie(c, COOKIE, {
      path: "/",
      secure: secure(c),
    })
  }
}
