import { Hono, type Context } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import type { User } from "@workos-inc/node"
import {
  createWorkOSClient,
  requireCookiePassword,
  requireNonEmpty,
  validateWorkosSession,
  WORKOS_SESSION_COOKIE_NAME,
} from "@veritly/auth-shared"
import { Log } from "../../util/log"
import { isOpencodeWorkosEnabled } from "../workos-env"

const log = Log.create({ service: "auth" })
const COOKIE_NAME = WORKOS_SESSION_COOKIE_NAME

let cachedWorkOS: ReturnType<typeof createWorkOSClient> | null = null

function getWorkOS() {
  if (cachedWorkOS) return cachedWorkOS

  const apiKey = process.env["WORKOS_API_KEY"]
  const clientId = process.env["WORKOS_CLIENT_ID"]

  if (!apiKey || !clientId) {
    throw new Error("WorkOS is not configured. Set WORKOS_API_KEY and WORKOS_CLIENT_ID")
  }

  cachedWorkOS = createWorkOSClient({ apiKey, clientId })
  return cachedWorkOS
}

/** Browser persistence for the sealed session (WorkOS access JWT is shorter-lived; it is refreshed by the server on demand). */
const WOS_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7

/** Path/domain/flags shared by set and delete. Omit `maxAge` so delete can clear the cookie. */
function cookieBase() {
  const isProduction = process.env["NODE_ENV"] === "production"
  return {
    path: "/",
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    domain: isProduction ? ".veritly.co.uk" : undefined,
  }
}

export function getCookieOptions() {
  return { ...cookieBase(), maxAge: WOS_SESSION_MAX_AGE_SEC }
}

export type SessionUser = User

export const AuthRoutes = new Hono()
  .get("/login", async (c) => {
    try {
      const redirectUri = requireNonEmpty(process.env["WORKOS_REDIRECT_URI"], "WORKOS_REDIRECT_URI")
      const clientId = requireNonEmpty(process.env["WORKOS_CLIENT_ID"], "WORKOS_CLIENT_ID")

      const url = getWorkOS().userManagement.getAuthorizationUrl({
        provider: "authkit",
        redirectUri,
        clientId,
      })

      return c.redirect(url)
    } catch (error) {
      log.error("Failed to get sign in URL", { error })
      return c.json({ error: "Failed to initiate login" }, 500)
    }
  })
  .get("/callback", async (c) => {
    try {
      const code = c.req.query("code")
      if (!code) {
        return c.json({ error: "Missing authorization code" }, 400)
      }

      const clientId = requireNonEmpty(process.env["WORKOS_CLIENT_ID"], "WORKOS_CLIENT_ID")
      const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])

      const { sealedSession } = await getWorkOS().userManagement.authenticateWithCode({
        clientId,
        code,
        session: {
          sealSession: true,
          cookiePassword,
        },
      })

      if (sealedSession) {
        setCookie(c, COOKIE_NAME, sealedSession, getCookieOptions())
      }

      const frontendUrl = process.env["PUBLIC_BASE_URL"] || "https://app.veritly.co.uk"
      return c.redirect(`${frontendUrl}/auth/callback?success=1`)
    } catch (error) {
      log.error("Failed to authenticate callback", { error })
      const frontendUrl = process.env["PUBLIC_BASE_URL"] || "https://app.veritly.co.uk"
      return c.redirect(`${frontendUrl}/auth/callback?error=1`)
    }
  })
  .get("/logout", async (c) => {
    try {
      const sessionData = getCookie(c, COOKIE_NAME)
      if (sessionData) {
        const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])

        try {
          const session = await getWorkOS().userManagement.loadSealedSession({
            sessionData,
            cookiePassword,
          })
          const url = await session.getLogoutUrl()
          deleteCookie(c, COOKIE_NAME, { ...cookieBase(), path: "/" })
          return c.redirect(url)
        } catch {
          deleteCookie(c, COOKIE_NAME, { ...cookieBase(), path: "/" })
        }
      }

      const frontendUrl = process.env["PUBLIC_BASE_URL"] || "https://app.veritly.co.uk"
      return c.redirect(`${frontendUrl}/auth/logged-out`)
    } catch (error) {
      log.error("Failed to sign out", { error })
      return c.json({ error: "Failed to sign out" }, 500)
    }
  })
  .get("/session", async (c) => {
    if (!isOpencodeWorkosEnabled()) {
      return c.json({ user: null })
    }

    const sessionData = getCookie(c, COOKIE_NAME)
    if (!sessionData) {
      return c.json({ user: null })
    }

    try {
      const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])
      const result = await validateWorkosSession({
        workos: getWorkOS(),
        sessionData,
        cookiePassword,
      })

      if (!result.ok) {
        deleteCookie(c, COOKIE_NAME, { ...cookieBase(), path: "/" })
        return c.json({ user: null })
      }

      if (result.refreshedSessionData) {
        setCookie(c, COOKIE_NAME, result.refreshedSessionData, getCookieOptions())
      }

      return c.json({ user: result.user })
    } catch (error) {
      log.warn("Failed to validate session", { error })
      deleteCookie(c, COOKIE_NAME, { ...cookieBase(), path: "/" })
      return c.json({ user: null })
    }
  })

export async function getSessionUser(): Promise<User | null> {
  const sessionData = process.env["WORKOS_SESSION_DATA"]
  if (!sessionData) return null

  try {
    const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])
    const result = await validateWorkosSession({
      workos: getWorkOS(),
      sessionData,
      cookiePassword,
    })

    if (!result.ok) return null
    return result.user
  } catch {
    return null
  }
}

export async function getRequestUser(c: Pick<Context, "req">): Promise<User | null> {
  const sessionData = getCookie(c as Context, COOKIE_NAME)
  if (!sessionData) return null

  try {
    const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])
    const result = await validateWorkosSession({
      workos: getWorkOS(),
      sessionData,
      cookiePassword,
    })

    if (!result.ok) return null
    return result.user
  } catch {
    return null
  }
}
