import type { Context, MiddlewareHandler } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { basicAuth } from "hono/basic-auth"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"

/**
 * JupyterHub OAuth2 Authorization Code flow for singleuser servers.
 *
 * Replicates what jupyter-labhub does in Python:
 * 1. Unauthenticated browser request -> redirect to Hub OAuth authorize
 * 2. Hub authenticates user via its own session cookie
 * 3. Hub redirects back with authorization code
 * 4. Server exchanges code for access token
 * 5. Server fetches user info with the token
 * 6. Compares user with JUPYTERHUB_USER (container owner)
 * 7. Issues a session cookie for subsequent requests
 */
export namespace HubAuth {
  const log = Log.create({ service: "hub-auth" })

  const COOKIE = "opencode-hub-session"
  const STATE_COOKIE = "opencode-hub-state"
  const SESSION_TTL = 5 * 60 * 1000

  interface Session {
    user: string
    expires: number
  }

  const sessions = new Map<string, Session>()

  export function enabled(): boolean {
    return !!(Flag.JUPYTERHUB_API_URL && Flag.JUPYTERHUB_API_TOKEN && Flag.JUPYTERHUB_USER)
  }

  function api(path: string): string {
    return `${Flag.JUPYTERHUB_API_URL!.replace(/\/+$/, "")}${path}`
  }

  function authorizeUrl(callback: string, state: string): string {
    const base = Flag.JUPYTERHUB_BASE_URL?.replace(/\/+$/, "") ?? ""
    const params = new URLSearchParams({
      client_id: Flag.JUPYTERHUB_CLIENT_ID ?? "",
      redirect_uri: callback,
      response_type: "code",
      state,
    })
    if (Flag.JUPYTERHUB_OAUTH_ACCESS_SCOPES) params.set("scope", Flag.JUPYTERHUB_OAUTH_ACCESS_SCOPES)
    return `${base}/hub/api/oauth2/authorize?${params}`
  }

  async function exchange(code: string, callback: string): Promise<string | undefined> {
    try {
      const res = await fetch(api("/oauth2/token"), {
        method: "POST",
        headers: {
          "Authorization": `token ${Flag.JUPYTERHUB_API_TOKEN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callback,
        }),
      })
      if (!res.ok) {
        log.warn("token exchange failed", { status: res.status })
        return undefined
      }
      return ((await res.json()) as { access_token?: string }).access_token
    } catch (err) {
      log.error("token exchange error", { error: err })
      return undefined
    }
  }

  async function userinfo(token: string): Promise<string | undefined> {
    try {
      const res = await fetch(api("/user"), {
        headers: { Authorization: `token ${token}` },
      })
      if (!res.ok) {
        log.warn("userinfo failed", { status: res.status })
        return undefined
      }
      return ((await res.json()) as { name?: string }).name
    } catch (err) {
      log.error("userinfo error", { error: err })
      return undefined
    }
  }

  function callbackPath(): string {
    const prefix = Flag.JUPYTERHUB_SERVICE_PREFIX?.replace(/\/+$/, "") ?? ""
    return `${prefix}/oauth_callback`
  }

  function buildCallbackUrl(c: Context): string {
    if (Flag.JUPYTERHUB_OAUTH_CALLBACK_URL) return Flag.JUPYTERHUB_OAUTH_CALLBACK_URL
    const proto = c.req.header("x-forwarded-proto") ?? "http"
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost"
    return `${proto}://${host}${callbackPath()}`
  }

  /** Hono route handler for GET /oauth_callback */
  export async function callback(c: Context): Promise<Response> {
    const code = c.req.query("code")
    const state = c.req.query("state")
    const saved = getCookie(c, STATE_COOKIE)

    if (!code || !state || state !== saved) {
      log.warn("invalid oauth callback", { has_code: !!code, state_match: state === saved })
      return c.text("Bad request", 400)
    }

    setCookie(c, STATE_COOKIE, "", { path: "/", maxAge: 0 })

    const next = c.req.query("next") ?? "/"
    const cb = buildCallbackUrl(c)
    // strip the next param from callback for token exchange (must match the registered redirect_uri)
    const bare = cb.split("?")[0]!
    const token = await exchange(code, bare)
    if (!token) return c.text("Token exchange failed", 502)

    const name = await userinfo(token)
    if (!name) return c.text("Failed to identify user", 502)

    if (name !== Flag.JUPYTERHUB_USER) {
      log.warn("access denied", { requesting_user: name, owner: Flag.JUPYTERHUB_USER })
      return c.text("Forbidden", 403)
    }

    const sid = crypto.randomUUID()
    sessions.set(sid, { user: name, expires: Date.now() + SESSION_TTL })
    setCookie(c, COOKIE, sid, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: c.req.url.startsWith("https"),
      maxAge: SESSION_TTL / 1000,
    })

    return c.redirect(next)
  }

  /**
   * Combined auth middleware that handles both Hub OAuth and Basic Auth.
   *
   * When Hub OAuth is enabled (JUPYTERHUB_API_URL set):
   *   - Valid session cookie -> allow
   *   - Basic Auth header or ?token -> validate with Basic Auth
   *   - Neither -> redirect to Hub OAuth
   *
   * When Hub OAuth is disabled:
   *   - OPENCODE_SERVER_PASSWORD set -> validate Basic Auth
   *   - Not set -> allow (no auth)
   */
  export function auth(): MiddlewareHandler {
    return async (c, next) => {
      if (c.req.method === "OPTIONS") return next()
      if (c.req.path === "/oauth_callback") return next()

      const password = Flag.OPENCODE_SERVER_PASSWORD
      const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"

      // --- Hub OAuth mode ---
      if (enabled()) {
        // 1. check session cookie
        const sid = getCookie(c, COOKIE)
        if (sid) {
          const session = sessions.get(sid)
          if (session && session.expires > Date.now() && session.user === Flag.JUPYTERHUB_USER) {
            return next()
          }
          sessions.delete(sid)
        }

        // 2. fall through to Basic Auth if credentials are present
        if (password) {
          const token = c.req.query("token")
          if (token) {
            const raw = Buffer.from(token, "base64").toString()
            const i = raw.indexOf(":")
            if (i !== -1 && raw.slice(0, i) === username && raw.slice(i + 1) === password) return next()
          }
          const header = c.req.header("authorization")
          if (header?.startsWith("Basic ")) {
            return basicAuth({ username, password })(c, next)
          }
        }

        // 3. browser request -> redirect to Hub OAuth
        const state = crypto.randomUUID()
        const target = c.req.path === "/oauth_callback" ? "/" : c.req.path
        const cb = `${buildCallbackUrl(c)}?next=${encodeURIComponent(target)}`
        setCookie(c, STATE_COOKIE, state, {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: c.req.url.startsWith("https"),
          maxAge: 300,
        })
        return c.redirect(authorizeUrl(cb, state))
      }

      // --- Basic Auth only mode (no Hub) ---
      if (!password) return next()
      const token = c.req.query("token")
      if (token) {
        const raw = Buffer.from(token, "base64").toString()
        const i = raw.indexOf(":")
        if (i !== -1 && raw.slice(0, i) === username && raw.slice(i + 1) === password) return next()
      }
      return basicAuth({ username, password })(c, next)
    }
  }
}
