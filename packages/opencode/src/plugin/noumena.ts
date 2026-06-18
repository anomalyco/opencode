import { createServer } from "node:http"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { OAUTH_DUMMY_KEY } from "../auth"

const AUTHORIZE_URL = "https://code.noumena.com/oauth/authorize"
const TOKEN_URL = "https://api.noumena.com/oauth/token"
const OAUTH_BETA_HEADER = "oauth-2025-04-20"
const SCOPES = "user:profile user:inference user:sessions:ncode user:mcp_servers user:file_upload"

type Pkce = {
  verifier: string
  challenge: string
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

type RefreshResult = {
  access: string
  refresh: string
  expires: number
}

export async function NoumenaAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "noumena",
      methods: [
        {
          type: "oauth",
          label: "Noumena Code (browser)",
          async authorize() {
            const pkce = await generatePKCE()
            const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
            const server = await startOAuthServer(state)
            return {
              method: "auto",
              url: authorizeURL(server.redirect, pkce, state),
              instructions: "Complete authorization in your browser. This window will close automatically.",
              async callback() {
                try {
                  const code = await server.code
                  return success(await exchangeCode(code, server.redirect, pkce, state))
                } finally {
                  server.close()
                }
              },
            }
          },
        },
        {
          type: "oauth",
          label: "Noumena Code (manual code)",
          async authorize() {
            const pkce = await generatePKCE()
            const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
            const redirect = manualRedirectURL()
            return {
              method: "code",
              url: authorizeURL(redirect, pkce, state),
              instructions: "Open the URL, complete authorization, then paste the authorization code.",
              async callback(code: string) {
                return success(await exchangeCode(code, redirect, pkce, state))
              },
            }
          },
        },
      ],
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        let refreshPromise: Promise<RefreshResult> | undefined

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            let currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            if (!currentAuth.access || currentAuth.expires <= Date.now()) {
              if (!refreshPromise) {
                const refreshToken = currentAuth.refresh
                refreshPromise = refreshAccessToken(refreshToken)
                  .then(async (tokens) => {
                    const refreshed = {
                      access: tokens.access_token,
                      refresh: tokens.refresh_token ?? refreshToken,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                    }
                    await input.client.auth.set({
                      path: { id: "noumena" },
                      body: {
                        type: "oauth",
                        access: refreshed.access,
                        refresh: refreshed.refresh,
                        expires: refreshed.expires,
                      },
                    })
                    return refreshed
                  })
                  .finally(() => {
                    refreshPromise = undefined
                  })
              }

              currentAuth = { ...currentAuth, ...(await refreshPromise) }
            }

            const headers = new Headers(init?.headers)
            headers.delete("authorization")
            headers.delete("Authorization")
            headers.delete("x-api-key")
            headers.delete("X-Api-Key")
            headers.set("Authorization", `Bearer ${currentAuth.access}`)
            headers.set("anthropic-beta", OAUTH_BETA_HEADER)

            return fetch(requestInput, { ...init, headers })
          },
        }
      },
    },
  }
}

function authorizeBaseURL() {
  const web = process.env.NOUMENA_OAUTH_WEB_BASE_URL?.trim().replace(/\/$/, "")
  return web ? `${web}/oauth/authorize` : AUTHORIZE_URL
}

function manualRedirectURL() {
  const web = process.env.NOUMENA_OAUTH_WEB_BASE_URL?.trim().replace(/\/$/, "")
  return web ? `${web}/oauth/code/callback?app=noumena-code` : "https://code.noumena.com/oauth/code/callback?app=noumena-code"
}

function tokenURL() {
  const issuer = process.env.NOUMENA_ISSUER_BASE_URL?.trim().replace(/\/$/, "")
  return issuer ? `${issuer}/oauth/token` : TOKEN_URL
}

function clientID() {
  return process.env.NOUMENA_OAUTH_CLIENT_ID || "noumena-code"
}

function authorizeURL(redirect: string, pkce: Pkce, state: string) {
  return `${authorizeBaseURL()}?${new URLSearchParams({
    code: "true",
    response_type: "code",
    client_id: clientID(),
    redirect_uri: redirect,
    scope: SCOPES,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  })}`
}

async function startOAuthServer(state: string) {
  const server = createServer()
  const callback = new Promise<string>((resolve, reject) => {
    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      if (url.pathname !== "/callback") {
        response.writeHead(404).end("Not found")
        return
      }
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
      const value = url.searchParams.get("code")
      if (error) {
        reject(new Error(error))
        response.writeHead(400, { "Content-Type": "text/html" }).end(errorPage(error))
        return
      }
      if (!value || url.searchParams.get("state") !== state) {
        const message = value ? "Invalid OAuth state" : "Missing authorization code"
        reject(new Error(message))
        response.writeHead(400, { "Content-Type": "text/html" }).end(errorPage(message))
        return
      }
      resolve(value)
      response.writeHead(200, { "Content-Type": "text/html" }).end(successPage)
    })
    server.once("error", reject)
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "localhost", () => resolve())
    server.once("error", reject)
  })
  const address = server.address()
  if (typeof address !== "object" || !address) {
    server.close()
    throw new Error("Failed to allocate OAuth callback port")
  }
  return {
    redirect: `http://localhost:${address.port}/callback`,
    code: callback,
    close: () => server.close(),
  }
}

async function exchangeCode(code: string, redirect: string, pkce: Pkce, state: string): Promise<TokenResponse> {
  const response = await fetch(tokenURL(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "anthropic-beta": OAUTH_BETA_HEADER,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientID(),
      code_verifier: pkce.verifier,
      state,
    }),
  })
  if (!response.ok) throw new Error(`Noumena OAuth exchange failed: ${response.status}`)
  return response.json()
}

function success(tokens: TokenResponse) {
  return {
    type: "success" as const,
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? "",
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  }
}

async function generatePKCE(): Promise<Pkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)), (byte) => chars[byte % chars.length]).join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url")
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(tokenURL(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "anthropic-beta": OAUTH_BETA_HEADER,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientID(),
      scope: SCOPES,
    }),
  })
  if (!response.ok) throw new Error(`Noumena OAuth refresh failed: ${response.status}`)
  return response.json()
}

const successPage =
  "<!doctype html><title>OpenCode</title><h1>Authorization successful</h1><p>You can close this window.</p>"
const errorPage = (message: string) =>
  `<!doctype html><title>OpenCode</title><h1>Authorization failed</h1><p>${message.replace(/[&<>\"']/g, "")}</p>`
