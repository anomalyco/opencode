import { Hono } from "hono"
import type { ServerAuthConfig } from "./config"
import { ServerAuthOidc } from "./oidc"
import { ServerAuthSession } from "./session"
import { ServerAuthVerify } from "./verify"

const stateCookie = "opencode_oidc_state"
const nonceCookie = "opencode_oidc_nonce"
const verifierCookie = "opencode_oidc_verifier"
const returnCookie = "opencode_oidc_return"
const temporaryCookies = [stateCookie, nonceCookie, verifierCookie, returnCookie]

export function routes(config: ServerAuthConfig.Info): Hono {
  return new Hono()
    .get("/login", async (c) => {
      if (config.mode !== "oidc") return c.json({ error: "OIDC auth is not enabled" }, 404)
      const requestUrl = new URL(c.req.url)
      const state = ServerAuthOidc.nonce()
      const nonce = ServerAuthOidc.nonce()
      const verifier = ServerAuthOidc.verifier()
      const redirectURI = config.oidc.redirectURI ?? new URL("/auth/callback", requestUrl.origin).toString()
      const url = await ServerAuthOidc.authorizationUrl({
        config: config.oidc,
        redirectURI,
        state,
        nonce,
        challenge: ServerAuthOidc.challenge(verifier),
      })
      c.header("set-cookie", ServerAuthSession.temporaryCookie(config.session, stateCookie, state), { append: true })
      c.header("set-cookie", ServerAuthSession.temporaryCookie(config.session, nonceCookie, nonce), { append: true })
      c.header("set-cookie", ServerAuthSession.temporaryCookie(config.session, verifierCookie, verifier), {
        append: true,
      })
      c.header(
        "set-cookie",
        ServerAuthSession.temporaryCookie(
          config.session,
          returnCookie,
          encodeURIComponent(ServerAuthOidc.safeReturnTo(requestUrl.searchParams.get("return_to"))),
        ),
        { append: true },
      )
      return c.redirect(url.toString())
    })
    .get("/callback", async (c) => {
      if (config.mode !== "oidc") return c.json({ error: "OIDC auth is not enabled" }, 404)
      const requestUrl = new URL(c.req.url)
      const clearTemporaryCookies = () => {
        temporaryCookies.forEach((name) => {
          c.header("set-cookie", ServerAuthSession.clearCookie(config.session, name), { append: true })
        })
      }
      const state = ServerAuthSession.readCookie(c.req.header("cookie"), stateCookie)
      const nonce = ServerAuthSession.readCookie(c.req.header("cookie"), nonceCookie)
      const verifier = ServerAuthSession.readCookie(c.req.header("cookie"), verifierCookie)
      if (!state || !nonce || !verifier || requestUrl.searchParams.get("state") !== state) {
        clearTemporaryCookies()
        return c.json({ error: "Invalid OIDC state" }, 401)
      }
      const code = requestUrl.searchParams.get("code")
      if (!code) {
        clearTemporaryCookies()
        return c.json({ error: "Missing OIDC code" }, 400)
      }
      const redirectURI = config.oidc.redirectURI ?? new URL("/auth/callback", requestUrl.origin).toString()
      const identity = await ServerAuthOidc.exchange({ config: config.oidc, code, redirectURI, verifier })
        .then((token) => ServerAuthOidc.verifyIDToken({ config: config.oidc, token, nonce }))
        .catch(() => undefined)
      if (!identity) {
        clearTemporaryCookies()
        return c.json({ error: "OIDC authentication failed" }, 401)
      }
      c.header(
        "set-cookie",
        ServerAuthSession.cookie(
          config.session,
          ServerAuthSession.serialize(config.session, {
            type: "oidc",
            issuer: identity.issuer,
            subject: identity.subject,
            email: identity.email,
            name: identity.name,
            groups: identity.groups,
          }),
        ),
        { append: true },
      )
      clearTemporaryCookies()
      return c.redirect(ServerAuthOidc.safeReturnTo(returnTo(c.req.header("cookie"))))
    })
    .post("/logout", (c) => {
      c.header("set-cookie", ServerAuthSession.clearCookie(config.session), { append: true })
      return c.json(true)
    })
    .get("/me", async (c) => {
      try {
        return c.json(await ServerAuthVerify.request(config, c.req.raw))
      } catch {
        return c.json({ error: "Unauthorized" }, 401)
      }
    })
}

function returnTo(cookie: string | undefined) {
  try {
    return decodeURIComponent(ServerAuthSession.readCookie(cookie, returnCookie) ?? "%2F")
  } catch {
    return "/"
  }
}

export * as ServerAuthRoutes from "./routes"
