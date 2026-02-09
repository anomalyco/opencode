import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Log } from "../util/log"
import { Installation } from "../installation"
import { Auth, OAUTH_DUMMY_KEY } from "../auth"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import os from "os"
import { ProviderTransform } from "@/provider/transform"

const log = Log.create({ service: "plugin.codex" })

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage"
const OAUTH_PORT = 1455
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export interface IdTokenClaims {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
  }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims && extractAccountIdFromClaims(claims)
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    return claims ? extractAccountIdFromClaims(claims) : undefined
  }
  return undefined
}

export function extractEmail(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    if (claims?.email) return claims.email
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    if (claims?.email) return claims.email
  }
  return undefined
}

function isCodexRateLimitError(response: Response, body?: string): boolean {
  if (response.status === 429) return true
  if (!body) return false
  const lower = body.toLowerCase()
  return (
    lower.includes("5-hour message limit") ||
    lower.includes("weekly cap") ||
    lower.includes("quota exhausted") ||
    lower.includes("rate limit") ||
    lower.includes("usage limit")
  )
}

function parseCodexResetTime(body?: string): number | undefined {
  if (!body) return undefined
  // Parse "try again in Xh Ym" or "try again in X hours"
  const hourMatch = body.match(/try again in (\d+)\s*h/i)
  if (hourMatch) {
    return Date.now() + parseInt(hourMatch[1]) * 60 * 60 * 1000
  }
  const minuteMatch = body.match(/try again in (\d+)\s*m/i)
  if (minuteMatch) {
    return Date.now() + parseInt(minuteMatch[1]) * 60 * 1000
  }
  // Default to 5 hours if we can't parse
  return Date.now() + 5 * 60 * 60 * 1000
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return response.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }
  return response.json()
}

interface CodexUsageApiResponse {
  plan_type?: string
  rate_limit?: {
    allowed?: boolean
    limit_reached?: boolean
    primary_window?: {
      used_percent: number
      limit_window_seconds: number
      reset_after_seconds?: number
      reset_at?: number
    }
    secondary_window?: {
      used_percent: number
      limit_window_seconds: number
      reset_after_seconds?: number
      reset_at?: number
    }
  }
  credits?: {
    has_credits?: boolean
    unlimited?: boolean
    balance?: string
  }
}

function parseUsageFromHeaders(headers: Headers): Auth.CodexAccountUsage | undefined {
  const primaryUsed = headers.get("x-codex-primary-used-percent")
  const primaryWindow = headers.get("x-codex-primary-window-minutes")
  const primaryReset = headers.get("x-codex-primary-reset-at")

  if (!primaryUsed || !primaryWindow || !primaryReset) return undefined

  const secondaryUsed = headers.get("x-codex-secondary-used-percent")
  const secondaryWindow = headers.get("x-codex-secondary-window-minutes")
  const secondaryReset = headers.get("x-codex-secondary-reset-at")

  const hasCredits = headers.get("x-codex-credits-has-credits")
  const creditsBalance = headers.get("x-codex-credits-balance")

  const usage: Auth.CodexAccountUsage = {
    fetchedAt: Date.now(),
    primary: {
      usedPercent: parseInt(primaryUsed, 10),
      windowMinutes: parseInt(primaryWindow, 10),
      resetAt: parseInt(primaryReset, 10) * 1000,
    },
  }

  if (secondaryUsed && secondaryWindow && secondaryReset) {
    usage.secondary = {
      usedPercent: parseInt(secondaryUsed, 10),
      windowMinutes: parseInt(secondaryWindow, 10),
      resetAt: parseInt(secondaryReset, 10) * 1000,
    }
  }

  if (hasCredits !== null) {
    usage.credits = {
      hasCredits: hasCredits === "true",
      unlimited: false,
      balance: creditsBalance ?? undefined,
    }
  }

  return usage
}

function parseUsageFromApiResponse(response: CodexUsageApiResponse): Auth.CodexAccountUsage {
  const usage: Auth.CodexAccountUsage = {
    planType: response.plan_type,
    fetchedAt: Date.now(),
  }

  if (response.rate_limit?.primary_window) {
    const pw = response.rate_limit.primary_window
    usage.primary = {
      usedPercent: pw.used_percent,
      windowMinutes: Math.round(pw.limit_window_seconds / 60),
      resetAt: pw.reset_at ? pw.reset_at * 1000 : Date.now() + (pw.reset_after_seconds ?? 0) * 1000,
    }
  }

  if (response.rate_limit?.secondary_window) {
    const sw = response.rate_limit.secondary_window
    usage.secondary = {
      usedPercent: sw.used_percent,
      windowMinutes: Math.round(sw.limit_window_seconds / 60),
      resetAt: sw.reset_at ? sw.reset_at * 1000 : Date.now() + (sw.reset_after_seconds ?? 0) * 1000,
    }
  }

  if (response.credits) {
    usage.credits = {
      hasCredits: response.credits.has_credits ?? false,
      unlimited: response.credits.unlimited ?? false,
      balance: response.credits.balance,
    }
  }

  return usage
}

export async function fetchCodexUsage(account: Auth.CodexAccount): Promise<Auth.CodexAccountUsage> {
  let access = account.access
  let refresh = account.refresh

  // Refresh token if expired
  if (account.expires < Date.now()) {
    log.info("refreshing codex token for usage fetch", { email: account.email })
    const tokens = await refreshAccessToken(account.refresh)
    access = tokens.access_token
    refresh = tokens.refresh_token ?? account.refresh
    const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000
    const accountId = extractAccountId(tokens) || account.accountId
    await Auth.updateCodexAccountTokens(account.id, {
      access,
      refresh,
      expires: expiresAt,
      accountId,
    })
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${access}`,
  }
  if (account.accountId) {
    headers["ChatGPT-Account-Id"] = account.accountId
  }

  const response = await fetch(CODEX_USAGE_ENDPOINT, { headers })
  if (!response.ok) {
    throw new Error(`Usage fetch failed: ${response.status}`)
  }

  const data: CodexUsageApiResponse = await response.json()
  const usage = parseUsageFromApiResponse(data)

  // Persist usage to storage
  await Auth.updateCodexAccountUsage(account.id, usage)

  return usage
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>OpenCode - Codex Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to OpenCode.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>OpenCode - Codex Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${error}</div>
    </div>
  </body>
</html>`

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof Bun.serve> | undefined
let pendingOAuth: PendingOAuth | undefined

async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) {
    return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
  }

  oauthServer = Bun.serve({
    port: OAUTH_PORT,
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const errorDescription = url.searchParams.get("error_description")

        if (error) {
          const errorMsg = errorDescription || error
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(errorMsg), {
            headers: { "Content-Type": "text/html" },
          })
        }

        if (!code) {
          const errorMsg = "Missing authorization code"
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(errorMsg), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        if (!pendingOAuth || state !== pendingOAuth.state) {
          const errorMsg = "Invalid state - potential CSRF attack"
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(errorMsg), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        const current = pendingOAuth
        pendingOAuth = undefined

        exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
          .then((tokens) => current.resolve(tokens))
          .catch((err) => current.reject(err))

        return new Response(HTML_SUCCESS, {
          headers: { "Content-Type": "text/html" },
        })
      }

      if (url.pathname === "/cancel") {
        pendingOAuth?.reject(new Error("Login cancelled"))
        pendingOAuth = undefined
        return new Response("Login cancelled", { status: 200 })
      }

      return new Response("Not found", { status: 404 })
    },
  })

  log.info("codex oauth server started", { port: OAUTH_PORT })
  return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.stop()
    oauthServer = undefined
    log.info("codex oauth server stopped")
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      5 * 60 * 1000,
    ) // 5 minute timeout

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

export async function CodexAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "openai",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        // Check for Codex multi-account first
        const codexAuth = await Auth.getCodexAuth()
        const hasCodexAccounts = !!codexAuth?.accounts.length
        const hasLegacyOAuth = auth?.type === "oauth"

        // Support both legacy oauth and new codex-multi format
        if (!hasLegacyOAuth && !hasCodexAccounts) return {}

        // Filter models to only allowed Codex models for OAuth
        const allowedModels = new Set([
          "gpt-5.1-codex-max",
          "gpt-5.1-codex-mini",
          "gpt-5.2",
          "gpt-5.2-codex",
          "gpt-5.3-codex",
          "gpt-5.1-codex",
        ])
        for (const modelId of Object.keys(provider.models)) {
          if (!allowedModels.has(modelId)) {
            delete provider.models[modelId]
          }
        }

        if (!provider.models["gpt-5.3-codex"]) {
          const model = {
            id: "gpt-5.3-codex",
            providerID: "openai",
            api: {
              id: "gpt-5.3-codex",
              url: "https://chatgpt.com/backend-api/codex",
              npm: "@ai-sdk/openai",
            },
            name: "GPT-5.3 Codex",
            capabilities: {
              temperature: false,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 400_000, input: 272_000, output: 128_000 },
            status: "active" as const,
            options: {},
            headers: {},
            release_date: "2026-02-05",
            variants: {} as Record<string, Record<string, any>>,
            family: "gpt-codex",
          }
          model.variants = ProviderTransform.variants(model)
          provider.models["gpt-5.3-codex"] = model
        }

        // Zero out costs for Codex (included with ChatGPT subscription)
        for (const model of Object.values(provider.models)) {
          model.cost = {
            input: 0,
            output: 0,
            cache: { read: 0, write: 0 },
          }
        }

        const codexFetch = async (requestInput: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          // Remove dummy API key authorization header
          if (init?.headers) {
            if (init.headers instanceof Headers) {
              init.headers.delete("authorization")
              init.headers.delete("Authorization")
            } else if (Array.isArray(init.headers)) {
              init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization")
            } else {
              delete init.headers["authorization"]
              delete init.headers["Authorization"]
            }
          }

          // Get active account from multi-account storage
          let account = await Auth.getActiveCodexAccount()
          if (!account) {
            // Fallback to legacy single-account mode
            const currentAuth = await getAuth()
            if (!currentAuth || currentAuth.type !== "oauth") return fetch(requestInput, init)
            account = {
              id: "legacy",
              email: "unknown",
              refresh: currentAuth.refresh,
              access: currentAuth.access,
              expires: currentAuth.expires,
              accountId: (currentAuth as any).accountId,
            }
          }

          // Check if token needs refresh
          if (!account.access || account.expires < Date.now()) {
            log.info("refreshing codex access token", { email: account.email })
            const tokens = await refreshAccessToken(account.refresh)
            const newAccountId = extractAccountId(tokens) || account.accountId
            const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000
            const refresh = tokens.refresh_token ?? account.refresh
            await Auth.updateCodexAccountTokens(account.id, {
              access: tokens.access_token,
              refresh,
              expires: expiresAt,
              accountId: newAccountId,
            })
            account.access = tokens.access_token
            account.refresh = refresh
            account.expires = expiresAt
            account.accountId = newAccountId
          }

          // Build headers
          const headers = new Headers()
          if (init?.headers) {
            if (init.headers instanceof Headers) {
              init.headers.forEach((value, key) => headers.set(key, value))
            } else if (Array.isArray(init.headers)) {
              for (const [key, value] of init.headers) {
                if (value !== undefined) headers.set(key, String(value))
              }
            } else {
              for (const [key, value] of Object.entries(init.headers)) {
                if (value !== undefined) headers.set(key, String(value))
              }
            }
          }

          // Set authorization header with access token
          headers.set("authorization", `Bearer ${account.access}`)

          // Set ChatGPT-Account-Id header for organization subscriptions
          if (account.accountId) {
            headers.set("ChatGPT-Account-Id", account.accountId)
          }

          // Rewrite URL to Codex endpoint
          const parsed =
            requestInput instanceof URL
              ? requestInput
              : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)
          const url =
            parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
              ? new URL(CODEX_API_ENDPOINT)
              : parsed

          const response = await fetch(url, {
            ...init,
            headers,
          })

          // Capture usage from response headers (non-blocking)
          const headerUsage = parseUsageFromHeaders(response.headers)
          if (headerUsage) {
            Auth.updateCodexAccountUsage(account.id, headerUsage).catch(() => {})
          }

          // Check for rate limit error and handle account switching
          if (!response.ok) {
            const body = await response
              .clone()
              .text()
              .catch(() => undefined)
            if (isCodexRateLimitError(response, body)) {
              const resetTime = parseCodexResetTime(body)
              log.info("codex rate limit hit", { email: account.email, resetTime })

              // Mark current account as rate limited
              await Auth.markCodexAccountRateLimited(account.id, resetTime)

              // Try to switch to next available account
              const next = await Auth.getNextAvailableCodexAccount()
              if (next) {
                log.info("switching to next codex account", { email: next.account.email })
                Bus.publish(TuiEvent.ToastShow, {
                  variant: "warning",
                  message: `Rate limited. Switched to ${next.account.email}`,
                })
                // Retry the request with the new account
                return codexFetch(requestInput, init)
              }

              // All accounts are rate limited - notify user
              const accounts = await Auth.getCodexAccounts()
              if (accounts.length > 0) {
                const resetTimes = accounts
                  .map((a) => a.rateLimit?.resetAt)
                  .filter((time): time is number => typeof time === "number")
                if (resetTimes.length > 0) {
                  const nextReset = Math.min(...resetTimes)
                  const waitMinutes = Math.max(1, Math.ceil((nextReset - Date.now()) / 60000))
                  Bus.publish(TuiEvent.ToastShow, {
                    variant: "error",
                    message: `All accounts rate limited. Next available in ${waitMinutes}m`,
                  })
                } else {
                  Bus.publish(TuiEvent.ToastShow, {
                    variant: "error",
                    message: "All accounts rate limited.",
                  })
                }
              } else {
                Bus.publish(TuiEvent.ToastShow, {
                  variant: "error",
                  message: "Rate limited. Please try again later.",
                })
              }
            }
          }

          return response
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          fetch: codexFetch,
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser)",
          type: "oauth",
          authorize: async () => {
            const { redirectUri } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const authUrl = buildAuthorizeUrl(redirectUri, pkce, state)

            const callbackPromise = waitForOAuthCallback(pkce, state)

            return {
              url: authUrl,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                const tokens = await callbackPromise
                stopOAuthServer()
                const accountId = extractAccountId(tokens)
                const email = extractEmail(tokens)
                return {
                  type: "success" as const,
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  accountId,
                  email,
                }
              },
            }
          },
        },
        {
          label: "ChatGPT Pro/Plus (headless)",
          type: "oauth",
          authorize: async () => {
            const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": `opencode/${Installation.VERSION}`,
              },
              body: JSON.stringify({ client_id: CLIENT_ID }),
            })

            if (!deviceResponse.ok) throw new Error("Failed to initiate device authorization")

            const deviceData = (await deviceResponse.json()) as {
              device_auth_id: string
              user_code: string
              interval: string
            }
            const interval = Math.max(parseInt(deviceData.interval) || 5, 1) * 1000

            return {
              url: `${ISSUER}/codex/device`,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                while (true) {
                  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "User-Agent": `opencode/${Installation.VERSION}`,
                    },
                    body: JSON.stringify({
                      device_auth_id: deviceData.device_auth_id,
                      user_code: deviceData.user_code,
                    }),
                  })

                  if (response.ok) {
                    const data = (await response.json()) as {
                      authorization_code: string
                      code_verifier: string
                    }

                    const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
                      method: "POST",
                      headers: { "Content-Type": "application/x-www-form-urlencoded" },
                      body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: data.authorization_code,
                        redirect_uri: `${ISSUER}/deviceauth/callback`,
                        client_id: CLIENT_ID,
                        code_verifier: data.code_verifier,
                      }).toString(),
                    })

                    if (!tokenResponse.ok) {
                      throw new Error(`Token exchange failed: ${tokenResponse.status}`)
                    }

                    const tokens: TokenResponse = await tokenResponse.json()

                    return {
                      type: "success" as const,
                      refresh: tokens.refresh_token,
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      accountId: extractAccountId(tokens),
                    }
                  }

                  if (response.status !== 403 && response.status !== 404) {
                    return { type: "failed" as const }
                  }

                  await Bun.sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
    "chat.headers": async (input, output) => {
      if (input.model.providerID !== "openai") return
      output.headers.originator = "opencode"
      output.headers["User-Agent"] = `opencode/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`
      output.headers.session_id = input.sessionID
    },
  }
}
