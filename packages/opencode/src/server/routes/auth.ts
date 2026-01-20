import { Hono } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { Flag } from "../../flag/flag"
import { Log } from "../../util/log"
import { HTML_LOGIN } from "./auth-html"

const log = Log.create({ service: "server.auth" })

export function AuthRoutes() {
  const app = new Hono()

  app.get("/login", (c) => {
    return c.html(HTML_LOGIN)
  })

  app.post("/verify", async (c) => {
    const authHeader = c.req.header("Authorization")
    if (!authHeader) {
      return c.json({ error: "Missing authorization header" }, 401)
    }

    const match = authHeader.match(/^Basic (.+)$/)
    if (!match) {
      return c.json({ error: "Invalid authorization format" }, 401)
    }

    const credentials = atob(match[1])
    const [username, password] = credentials.split(":")

    const expectedUsername = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
    const expectedPassword = Flag.OPENCODE_SERVER_PASSWORD

    if (!expectedPassword) {
        // If no password set, always valid (though server config usually prevents this route being hit if no password)
        return c.json({ success: true })
    }

    if (username === expectedUsername && password === expectedPassword) {
        // Set a cookie for session persistence
        // We'll store the basic auth token directly or a simple marker
        // Storing the basic auth token allows us to reuse the basic auth logic in middleware
        setCookie(c, "opencode_auth", match[1], {
            path: "/",
            httpOnly: true, // Not accessible via JS
            secure: false, // Localhost usually plain HTTP
            sameSite: "Lax",
            maxAge: 60 * 60 * 24 * 7 // 7 days
        })
        return c.json({ success: true })
    }

    return c.json({ error: "Invalid credentials" }, 401)
  })

  return app
}
