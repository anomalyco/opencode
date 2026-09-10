import { Hono } from "hono"
import { exchangeToken, type ExchangeConfig } from "./exchange"
import {
  getStoredConfig,
  setStoredConfig,
  exchangeManifestCode,
  renderLandingPage,
  renderSuccessPage,
  renderErrorPage,
} from "./setup"

const app = new Hono()

function getGhesHost(): string {
  const ghesHost = process.env["GHES_HOST"]
  if (!ghesHost) throw new Error("GHES_HOST environment variable is required")
  return ghesHost
}

function getConfig(): ExchangeConfig | null {
  const ghesHost = process.env["GHES_HOST"]
  const appId = process.env["GHES_APP_ID"]
  const appPrivateKey = process.env["GHES_APP_PRIVATE_KEY"]

  if (ghesHost && appId && appPrivateKey) {
    return { ghesHost, appId, appPrivateKey }
  }

  // Fall back to in-memory config from manifest flow
  return getStoredConfig()
}

function getRouteHost(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("X-Forwarded-Host") || c.req.header("Host") || "localhost:3000"
}

app.get("/", (c) => {
  const ghesHost = getGhesHost()
  const routeHost = getRouteHost(c)
  const config = getConfig()
  const configured = config !== null
  const appId = config?.appId || process.env["GHES_APP_ID"]

  return c.html(renderLandingPage(ghesHost, routeHost, configured, appId))
})

app.get("/setup/callback", async (c) => {
  const code = c.req.query("code")
  if (!code) {
    return c.html(renderErrorPage("No code parameter received from GitHub."), 400)
  }

  try {
    const ghesHost = getGhesHost()
    const result = await exchangeManifestCode(ghesHost, code)

    // Store config in-memory for immediate use
    setStoredConfig({
      ghesHost,
      appId: String(result.id),
      appPrivateKey: result.pem,
    })

    return c.html(renderSuccessPage(result, ghesHost))
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("Manifest code exchange failed:", message)
    return c.html(renderErrorPage(message), 500)
  }
})

app.get("/health", (c) => {
  const config = getConfig()
  return c.json({ status: "ok", configured: config !== null })
})

app.post("/exchange_github_app_token", async (c) => {
  const token = c.req.header("Authorization")?.replace(/^Bearer /, "")
  if (!token) {
    return c.json({ error: "Authorization header is required" }, { status: 401 })
  }

  const config = getConfig()
  if (!config) {
    return c.json(
      { error: "Exchange server is not configured. Visit the root URL to set up a GitHub App." },
      { status: 503 },
    )
  }

  try {
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

const config = getConfig()
if (config) {
  console.log(`GHES exchange server listening on port ${port}`)
} else {
  console.log(`GHES exchange server listening on port ${port} (setup mode — visit / to configure)`)
}
