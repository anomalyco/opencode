import type { Context, Next } from "hono"
import { setCookie } from "hono/cookie"
import type { SessionResolver } from "@veritly/auth-shared"
import { WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"
import { isUniverCompatPublicPath } from "./compat-public-path"
import { runWithRequestUserAsync } from "./request-user"

function compatSessionCookieOptions() {
  const prod = process.env.NODE_ENV === "production"
  return {
    path: "/",
    httpOnly: true,
    secure: prod,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7,
    ...(prod ? { domain: ".veritly.co.uk" as const } : {}),
  }
}

export function univerCompatAuthMiddleware(auth: SessionResolver) {
  return async (c: Context, next: Next) => {
    const path = c.req.path
    if (isUniverCompatPublicPath(path)) {
      await next()
      return
    }

    try {
      const result = await auth.resolve(c.req.raw)
      if (!result.ok) {
        const status = result.reason === "misconfigured" ? 503 : 401
        return c.json({ error: result.message }, status)
      }

      if (result.refreshedSessionData) {
        setCookie(c, WORKOS_SESSION_COOKIE_NAME, result.refreshedSessionData, compatSessionCookieOptions())
      }

      await runWithRequestUserAsync(result.user.id, () => next())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 400)
    }
  }
}
