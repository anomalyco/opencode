import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { OAUTH_DUMMY_KEY } from "../../auth"
import os from "os"
import { setTimeout as sleep } from "node:timers/promises"
import { createServer } from "http"
import { OpenAIWebSocketPool } from "./ws-pool"
import { OauthCallbackPage } from "@opencode-ai/core/oauth/page"
import { CODEX_CHUNK_TIMEOUT, CODEX_HEADER_TIMEOUT, fetchCodexHTTP } from "./codex-http"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_PORT = 1455
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
const ALLOWED_MODELS = new Set(["gpt-5.5", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini"])
const DISALLOWED_MODELS = new Set(["gpt-5.5-pro"])
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)))
    .map((b) => chars[b % chars.length])
    .join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
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

function requireRefreshToken(tokens: TokenResponse) {
  if (!tokens.refresh_token) throw new Error("OAuth authorization did not return a refresh token")
  return tokens.refresh_token
}

function requireAccessToken(tokens: TokenResponse) {
  const access = tokens.access_token?.trim()
  if (!access) throw new Error("OAuth refresh did not return a usable access token")
  return access
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
  refresh_token?: string
  expires_in?: number
}

interface CodexAuthPluginOptions {
  issuer?: string
  codexApiEndpoint?: string
  experimentalWebSockets?: boolean
  httpHeaderTimeout?: number
  httpChunkTimeout?: number
  websocketConnectTimeout?: number
  websocketIdleTimeout?: number
  websocketPoolFactory?: (options: {
    httpFetch: typeof fetch
    connectTimeout?: number
    idleTimeout?: number
  }) => ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & {
    close: () => void
    remove: (id: string) => void
  }
  codexHTTPTransport?: CodexHTTPTransport
}

interface CodexHTTPTransport {
  (input: RequestInfo | URL, init: RequestInit | undefined, options: { headerTimeout: number; chunkTimeout: number }): Promise<Response>
}

async function readRequestBody(request: Request) {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) return undefined
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          const abort = () => reject(request.signal.reason ?? new DOMException("Aborted", "AbortError"))
          request.signal.addEventListener("abort", abort, { once: true })
          void reader.closed.finally(() => request.signal.removeEventListener("abort", abort)).catch(() => {})
        }),
      ])
      if (part.done) return joinBytes(chunks)
      size += part.value.byteLength
      if (size > MAX_REQUEST_BODY_BYTES) {
        void reader.cancel()
        throw new Error(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`)
      }
      chunks.push(part.value)
    }
  } catch (error) {
    void reader.cancel()
    throw error
  }
}


function joinBytes(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
  chunks.reduce((offset, chunk) => (result.set(chunk, offset), offset + chunk.byteLength), 0)
  return result
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

async function refreshAccessToken(refreshToken: string, issuer = ISSUER): Promise<TokenResponse> {
  const response = await fetch(`${issuer}/oauth/token`, {
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

// Kept as a named export for plugin.codex tests; delegates to the shared branded page.
export const renderOAuthError = (error: string) => OauthCallbackPage.error(error, { provider: "ChatGPT" })

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) {
    return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
  }

  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`)

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const errorDescription = url.searchParams.get("error_description")

      if (error) {
        const errorMsg = errorDescription || error
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderOAuthError(errorMsg))
        return
      }

      if (!code) {
        const errorMsg = "Missing authorization code"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderOAuthError(errorMsg))
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        const errorMsg = "Invalid state - potential CSRF attack"
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderOAuthError(errorMsg))
        return
      }

      const current = pendingOAuth
      pendingOAuth = undefined

      exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(OauthCallbackPage.success({ provider: "ChatGPT" }))
      return
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"))
      pendingOAuth = undefined
      res.writeHead(200)
      res.end("Login cancelled")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  await new Promise<void>((resolve, reject) => {
    oauthServer!.listen(OAUTH_PORT, () => {
      resolve()
    })
    oauthServer!.on("error", reject)
  })

  return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.close(() => {})
    oauthServer = undefined
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

export async function CodexAuthPlugin(input: PluginInput, options: CodexAuthPluginOptions = {}): Promise<Hooks> {
  const issuer = options.issuer ?? ISSUER
  const codexApiEndpoint = options.codexApiEndpoint ?? CODEX_API_ENDPOINT
  let websocketFetchInstalled = false
  const websocketFetches: Array<ReturnType<typeof OpenAIWebSocketPool.createWebSocketFetch>> = []

  return {
    async dispose() {
      for (const websocketFetch of websocketFetches) websocketFetch.close()
      websocketFetches.length = 0
    },
    async event(input) {
      if (input.event.type !== "session.deleted") return
      for (const websocketFetch of websocketFetches) websocketFetch.remove(input.event.properties.info.id)
    },
    provider: {
      id: "openai",
      async models(provider, ctx) {
        if (ctx.auth?.type !== "oauth") return provider.models

        return Object.fromEntries(
          Object.entries(provider.models)
            .filter(([, model]) => {
              if (model.options.reasoningMode === "pro") return false
              if (ALLOWED_MODELS.has(model.api.id)) return true
              if (DISALLOWED_MODELS.has(model.api.id)) return false
              if (model.api.id === "gpt-5.6") return false
              const match = model.api.id.match(/^gpt-(\d+\.\d+)/)
              return match ? parseFloat(match[1]) > 5.4 : false
            })
            .map(([modelID, model]) => [
              modelID,
              {
                ...model,
                cost: {
                  input: 0,
                  output: 0,
                  cache: { read: 0, write: 0 },
                },
                limit: model.id.includes("gpt-5.5")
                  ? {
                      context: 400_000,
                      input: 272_000,
                      output: 128_000,
                    }
                  : model.id.includes("gpt-5.6")
                    ? {
                        context: 500_000,
                        input: 372_000,
                        output: 128_000,
                      }
                    : model.limit,
              },
            ]),
        )
      },
    },
    auth: {
      provider: "openai",
      async loader(getAuth) {
        const auth = await getAuth()
        const codexHTTPTransport = options.codexHTTPTransport ?? ((input, init, transportOptions) => fetchCodexHTTP(input, init, transportOptions))
        const oauthHTTPFetch = ((input: RequestInfo | URL, init?: RequestInit) => codexHTTPTransport(input, init, {
          headerTimeout: options.httpHeaderTimeout ?? CODEX_HEADER_TIMEOUT,
          chunkTimeout: options.httpChunkTimeout ?? CODEX_CHUNK_TIMEOUT,
        })) as typeof fetch
        const websocketFetch = options.experimentalWebSockets
          ? (options.websocketPoolFactory ?? OpenAIWebSocketPool.createWebSocketFetch)({
              httpFetch: auth.type === "oauth" ? oauthHTTPFetch : fetch,
              connectTimeout: options.websocketConnectTimeout ?? CODEX_HEADER_TIMEOUT,
              idleTimeout: options.websocketIdleTimeout ?? CODEX_CHUNK_TIMEOUT,
            })
          : undefined
        if (websocketFetch) {
          websocketFetches.push(websocketFetch)
          websocketFetchInstalled = true
        }
        if (auth.type !== "oauth") return websocketFetch ? { fetch: websocketFetch } : {}

        let refreshPromise:
          | Promise<{
              access: string
              accountId: string | undefined
            }>
          | undefined

        const awaitRefresh = async (signal: AbortSignal | undefined, failedAccess?: string) => {
          const latest = await getAuth()
          if (latest.type !== "oauth") throw new Error("OAuth credentials unavailable")
          if (failedAccess && latest.access?.trim() && latest.access !== failedAccess) return Object.freeze({ access: latest.access.trim(), accountId: latest.accountId })
          if (!refreshPromise) {
            refreshPromise = refreshAccessToken(latest.refresh, issuer).then(async (tokens) => {
              const access = requireAccessToken(tokens)
              const accountId = extractAccountId(tokens) || latest.accountId
              await input.client.auth.set({ path: { id: "openai" }, body: { type: "oauth", refresh: tokens.refresh_token?.trim() || latest.refresh, access, expires: Date.now() + (tokens.expires_in ?? 3600) * 1000, ...(accountId && { accountId }) } })
              return Object.freeze({ access, accountId })
            }).finally(() => { refreshPromise = undefined })
          }
          if (!signal) return refreshPromise
          return Promise.race([
            refreshPromise,
            new Promise<never>((_, reject) => {
              const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
              signal.addEventListener("abort", abort, { once: true })
              void refreshPromise!.finally(() => signal.removeEventListener("abort", abort)).catch(() => {})
            }),
          ])
        }

        return {
          headerTimeout: false,
          chunkTimeout: false,
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            const request = new Request(requestInput, init)
            const requestBody = await readRequestBody(request)
            const snapshot = { url: new URL(request.url), method: request.method, headers: new Headers(request.headers), body: requestBody, signal: request.signal }

            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth")
              return websocketFetch ? websocketFetch(snapshot.url, { ...init, method: snapshot.method, headers: snapshot.headers, body: snapshot.body }) : fetch(snapshot.url, { ...init, method: snapshot.method, headers: snapshot.headers, body: snapshot.body })

            const authWithAccount = currentAuth as typeof currentAuth & { accountId?: string }

            let credentials = Object.freeze({ access: currentAuth.access?.trim() ?? "", accountId: authWithAccount.accountId })
            if (!credentials.access || currentAuth.expires < Date.now()) credentials = await awaitRefresh(snapshot.signal)

            const headers = new Headers(snapshot.headers)
            headers.delete("authorization")
            headers.delete("chatgpt-account-id")
            headers.set("authorization", `Bearer ${credentials.access}`)
            if (credentials.accountId) {
              headers.set("ChatGPT-Account-Id", credentials.accountId)
            }

            const parsed =
              snapshot.url
            const url =
              parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
                ? new URL(codexApiEndpoint)
                : parsed

            const requestInit = {
              ...init,
              method: snapshot.method,
              body: snapshot.body,
              headers,
            }
            const sendDirect = (target: URL, directInit: RequestInit) => fetch(target, OpenAIWebSocketPool.withoutInternalHeaders(directInit))
            if (!parsed.pathname.includes("/v1/responses") && !parsed.pathname.includes("/chat/completions")) return sendDirect(snapshot.url, requestInit)
            const send = (access: string, accountId: string | undefined) => {
              const retryHeaders = new Headers(headers)
              retryHeaders.set("authorization", `Bearer ${access}`)
              if (accountId) retryHeaders.set("ChatGPT-Account-Id", accountId)
              const selected = websocketFetch && parsed.pathname.endsWith("/responses") ? websocketFetch : fetchCodexHTTP
              if (selected === websocketFetch) return selected(url, { ...requestInit, body: snapshot.body ? new TextDecoder().decode(snapshot.body) : undefined, headers: retryHeaders, signal: snapshot.signal })
              return selected(url, OpenAIWebSocketPool.withoutInternalHeaders({ ...requestInit, headers: retryHeaders }), {
                headerTimeout: options.httpHeaderTimeout ?? CODEX_HEADER_TIMEOUT,
                chunkTimeout: options.httpChunkTimeout ?? CODEX_CHUNK_TIMEOUT,
              })
            }
            const response = await send(credentials.access, credentials.accountId)
            if (response.status !== 401 || init?.signal?.aborted) return response
            void response.body?.cancel()
            const refreshed = await awaitRefresh(snapshot.signal, credentials.access)
            return send(refreshed.access, refreshed.accountId)
          },
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser)",
          type: "oauth",
          authorize: async () => {
            const { redirectUri } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
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
                return {
                  type: "success" as const,
                  refresh: requireRefreshToken(tokens),
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  accountId,
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
                "User-Agent": `opencode/${InstallationVersion}`,
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
                      "User-Agent": `opencode/${InstallationVersion}`,
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
                      refresh: requireRefreshToken(tokens),
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      accountId: extractAccountId(tokens),
                    }
                  }

                  if (response.status !== 403 && response.status !== 404) {
                    return { type: "failed" as const }
                  }

                  await sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
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
      output.headers["User-Agent"] = `opencode/${InstallationVersion} (${os.platform()} ${os.release()}; ${os.arch()})`
      output.headers["session-id"] = input.sessionID
      // Temporary fetch-layer hack: title generation currently shares the conversation
      // session ID, so the OpenAI plugin marks it for HTTP fallback until transport
      // context can be passed directly instead of smuggled through headers.
      if (websocketFetchInstalled && input.agent === "title") output.headers[OpenAIWebSocketPool.TITLE_HEADER] = "true"
    },
    "chat.params": async (input, output) => {
      if (input.model.providerID !== "openai") return
      // Match codex cli
      output.maxOutputTokens = undefined
    },
  }
}
