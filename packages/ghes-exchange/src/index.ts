import { Hono } from "hono"
import { exchangeToken, type ExchangeConfig } from "./exchange"

const app = new Hono()

function getConfig(): ExchangeConfig {
  const ghesHost = process.env["GHES_HOST"]
  const appId = process.env["GHES_APP_ID"]
  const appPrivateKey = process.env["GHES_APP_PRIVATE_KEY"]

  if (!ghesHost) throw new Error("GHES_HOST environment variable is required")
  if (!appId) throw new Error("GHES_APP_ID environment variable is required")
  if (!appPrivateKey) throw new Error("GHES_APP_PRIVATE_KEY environment variable is required")

  return { ghesHost, appId, appPrivateKey }
}

app.get("/health", (c) => {
  return c.json({ status: "ok" })
})

app.post("/exchange_github_app_token", async (c) => {
  const token = c.req.header("Authorization")?.replace(/^Bearer /, "")
  if (!token) {
    return c.json({ error: "Authorization header is required" }, { status: 401 })
  }

  try {
    const config = getConfig()
    const installationToken = await exchangeToken(token, config)
    return c.json({ token: installationToken })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("Token exchange failed:", message)
    return c.json({ error: message }, { status: 403 })
  }
})

const port = parseInt(process.env["PORT"] || "3000", 10)

export default {
  port,
  fetch: app.fetch,
}

console.log(`GHES exchange server listening on port ${port}`)
