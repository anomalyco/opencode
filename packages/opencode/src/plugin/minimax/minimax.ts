import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { setTimeout as sleep } from "node:timers/promises"
import { createHash, randomBytes } from "node:crypto"

const CLIENT_ID = "d38bdbee-2b8c-4c74-9a9c-5875fabe6317"
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const OAUTH_SCOPES = "openid profile coding_plan"
const REFRESH_BUFFER_MS = 5 * 60 * 1000
const POLL_SAFETY_MARGIN_MS = 1_000

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

// ===== Exported for tests =====

export interface RefreshResult {
  access_token: string
  refresh_token: string
  expired_in: number
  resource_url: string
}

export interface TokenSnapshot {
  access: string
  refresh: string
  expires: number
  resourceUrl: string
}

export interface DoRefreshOptions {
  authBaseUrl: string
  clientId: string
  refreshToken: string
  fetchImpl?: typeof fetch
  maxRetries?: number
  retryBackoffMs?: number
}

export async function doRefresh(opts: DoRefreshOptions): Promise<RefreshResult | null> {
  const f = opts.fetchImpl ?? fetch
  const maxRetries = opts.maxRetries ?? 2
  const baseBackoff = opts.retryBackoffMs ?? 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(baseBackoff * attempt)

    let response: Response | null = null
    try {
      response = await f(`${opts.authBaseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: opts.clientId,
          refresh_token: opts.refreshToken,
        }),
      })
    } catch {
      // Network / DNS / timeout — retry
      continue
    }

    if (response.status >= 400 && response.status < 500) {
      // 4xx means the refresh_token is genuinely invalid; retrying won't help.
      return null
    }
    if (!response.ok) {
      // 5xx — retry
      continue
    }

    const data = (await response.json()) as {
      status: string
      access_token?: string
      refresh_token?: string
      expired_in?: number
      resource_url?: string
    }

    if (data.status !== "success" || !data.access_token) return null

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? opts.refreshToken,
      expired_in: data.expired_in ?? 0,
      resource_url: data.resource_url ?? "",
    }
  }

  return null
}

export interface TokenStoreDeps {
  refresh: (refreshToken: string) => Promise<RefreshResult | null>
  persist: (snapshot: TokenSnapshot) => Promise<void>
  refreshBufferMs?: number
  now?: () => number
}

export class TokenStore {
  private state: TokenSnapshot | null = null
  private inflight: Promise<boolean> | null = null

  constructor(private readonly deps: TokenStoreDeps) {}

  set(snapshot: TokenSnapshot): void {
    this.state = snapshot
  }

  get(): TokenSnapshot | null {
    return this.state
  }

  async ensureFresh(): Promise<boolean> {
    const buffer = this.deps.refreshBufferMs ?? REFRESH_BUFFER_MS
    const now = this.deps.now ?? Date.now
    if (!this.state) return false
    // expires <= 0 means we don't have a real expiry — treat as expired and refresh.
    // (Previously this short-circuited as "infinite token, never refresh", which
    // would silently let the consumer use a long-dead access token.)
    const needsRefresh = this.state.expires <= 0 || this.state.expires < now() + buffer
    if (!needsRefresh) return true
    if (this.inflight) return this.inflight

    this.inflight = (async () => {
      try {
        const refreshed = await this.deps.refresh(this.state!.refresh)
        if (!refreshed) return false
        // Persist BEFORE updating in-memory state. If the disk write fails we
        // want the in-memory refresh_token to remain the OLD one — otherwise
        // a crash here leaves disk holding the now-invalid old token while
        // memory holds the new one, and the user is silently logged out next
        // time the process starts.
        const newResourceUrl = refreshed.resource_url || this.state!.resourceUrl
        await this.deps.persist({
          access: refreshed.access_token,
          refresh: refreshed.refresh_token,
          expires: refreshed.expired_in,
          resourceUrl: newResourceUrl,
        })
        this.state!.access = refreshed.access_token
        this.state!.refresh = refreshed.refresh_token
        this.state!.expires = refreshed.expired_in
        this.state!.resourceUrl = newResourceUrl
        return true
      } catch {
        return false
      } finally {
        this.inflight = null
      }
    })()
    return this.inflight
  }
}

export interface CallbackTokenInput {
  status: string
  access_token?: string
  refresh_token?: string
  expired_in?: number
  resource_url?: string
}

export type CallbackResult =
  | {
      type: "success"
      access: string
      refresh: string
      expires: number
      enterpriseUrl?: string
    }
  | { type: "failed" }
  | { type: "pending" }

export function parseDeviceTokenResponse(token: CallbackTokenInput): CallbackResult {
  if (token.status === "pending") return { type: "pending" }
  if (token.status !== "success") return { type: "failed" }
  if (!token.access_token) return { type: "failed" }
  // refresh_token is required — without it we can't refresh, and storing ""
  // would silently break the next refresh attempt with a 400 from the server.
  if (!token.refresh_token) return { type: "failed" }
  return {
    type: "success",
    access: token.access_token,
    refresh: token.refresh_token,
    expires: token.expired_in ?? 0,
    enterpriseUrl: token.resource_url,
  }
}

// ===== Plugin =====

interface MinimaxRegionConfig {
  provider: string
  authBaseUrl: string
  defaultResourceUrl: string
}

function createMinimaxAuthPlugin(config: MinimaxRegionConfig) {
  const { provider, authBaseUrl, defaultResourceUrl } = config

  return async function MinimaxPlugin(_input: PluginInput): Promise<Hooks> {
    const persist = async (s: TokenSnapshot) => {
      await _input.client.auth.set({
        path: { id: provider },
        body: {
          type: "oauth",
          access: s.access,
          refresh: s.refresh,
          expires: s.expires,
          enterpriseUrl: s.resourceUrl,
        },
      })
    }

    const store = new TokenStore({
      refresh: (rt) => doRefresh({ authBaseUrl, clientId: CLIENT_ID, refreshToken: rt }),
      persist,
    })

    return {
      "chat.headers": async (input, output) => {
        if (!input.model.providerID.startsWith("minimax")) return
        const state = store.get()
        if (state && input.model.providerID === provider) {
          const ok = await store.ensureFresh()
          if (!ok) {
            throw new Error(
              "MiniMax session expired and could not be refreshed. Run /connect to sign in again.",
            )
          }
          const fresh = store.get()!
          output.headers["x-api-key"] = fresh.access
          output.headers["Authorization"] = `Bearer ${fresh.access}`
        }
      },
      auth: {
        provider,

        async loader(getAuth) {
          const info = await getAuth()
          if (!info || info.type !== "oauth") return {}

          let accessToken = info.access
          let resourceUrl = info.enterpriseUrl ?? defaultResourceUrl

          let refreshToken = info.refresh
          let expiresAt = info.expires
          if (info.expires > 0 && info.expires < Date.now() + REFRESH_BUFFER_MS) {
            const refreshed = await doRefresh({
              authBaseUrl,
              clientId: CLIENT_ID,
              refreshToken: info.refresh,
            }).catch(() => null)
            if (refreshed) {
              accessToken = refreshed.access_token
              refreshToken = refreshed.refresh_token
              expiresAt = refreshed.expired_in
              if (refreshed.resource_url) resourceUrl = refreshed.resource_url
              await persist({
                access: refreshed.access_token,
                refresh: refreshed.refresh_token,
                expires: refreshed.expired_in,
                resourceUrl,
              })
            }
          }

          store.set({
            access: accessToken,
            refresh: refreshToken,
            expires: expiresAt,
            resourceUrl,
          })

          return {
            baseURL: resourceUrl,
            apiKey: accessToken,
          }
        },

        methods: [
          {
            type: "oauth",
            label: "Sign in with MiniMax",

            async authorize() {
              const codeVerifier = generateCodeVerifier()
              const codeChallenge = generateCodeChallenge(codeVerifier)
              const state = randomBytes(16).toString("base64url")

              const response = await fetch(`${authBaseUrl}/oauth2/device/code`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  client_id: CLIENT_ID,
                  scope: OAUTH_SCOPES,
                  code_challenge: codeChallenge,
                  code_challenge_method: "S256",
                  state,
                }),
              })

              if (!response.ok) {
                throw new Error(`Failed to initiate MiniMax device authorization: ${response.status}`)
              }

              const data = (await response.json()) as {
                verification_uri: string
                user_code: string
                expired_in: number
                interval: number
                state: string
              }

              if (data.state !== state) {
                throw new Error("OAuth state mismatch: possible CSRF attack")
              }

              const pollIntervalMs = data.interval ?? 5000
              const deadline = data.expired_in

              return {
                url: data.verification_uri,
                instructions: `Enter code: ${data.user_code}`,
                method: "auto" as const,

                async callback() {
                  while (Date.now() < deadline) {
                    await sleep(pollIntervalMs + POLL_SAFETY_MARGIN_MS)

                    const tokenResponse = await fetch(`${authBaseUrl}/oauth2/token`, {
                      method: "POST",
                      headers: { "Content-Type": "application/x-www-form-urlencoded" },
                      body: new URLSearchParams({
                        grant_type: DEVICE_GRANT_TYPE,
                        client_id: CLIENT_ID,
                        user_code: data.user_code,
                        code_verifier: codeVerifier,
                      }),
                    }).catch(() => null)

                    if (!tokenResponse || !tokenResponse.ok) return { type: "failed" as const }

                    const tokenData = (await tokenResponse.json()) as CallbackTokenInput
                    const parsed = parseDeviceTokenResponse(tokenData)
                    if (parsed.type === "pending") continue
                    if (parsed.type === "failed") return { type: "failed" as const }
                    return {
                      type: "success" as const,
                      access: parsed.access,
                      refresh: parsed.refresh,
                      expires: parsed.expires,
                      enterpriseUrl: parsed.enterpriseUrl,
                    }
                  }

                  return { type: "failed" as const }
                },
              }
            },
          },
          {
            type: "api",
            label: "Paste Token Plan key",
          },
        ],
      },
    }
  }
}

export const MinimaxAuthPlugin = createMinimaxAuthPlugin({
  provider: "minimax-coding-plan",
  authBaseUrl: "https://account.minimax.io",
  defaultResourceUrl: "https://api.minimax.io/anthropic/v1",
})

export const MinimaxCnAuthPlugin = createMinimaxAuthPlugin({
  provider: "minimax-cn-coding-plan",
  authBaseUrl: "https://account.minimaxi.com",
  defaultResourceUrl: "https://api.minimaxi.com/anthropic/v1",
})
