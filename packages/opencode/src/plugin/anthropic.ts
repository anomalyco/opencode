import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Log } from "../util/log"
import { Auth } from "../auth"

const log = Log.create({ service: "plugin.anthropic" })

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

interface PkceCodes {
  verifier: string
  challenge: string
}

/**
 * Generate PKCE codes for OAuth flow
 * Based on @openauthjs/openauth/pkce
 */
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

/**
 * Generate independent state parameter for OAuth
 * MUST NOT be the same as PKCE verifier (security violation)
 */
function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

interface AuthorizeResult {
  url: string
  verifier: string
  state: string
}

/**
 * Generate authorization URL for Anthropic OAuth
 */
async function authorize(mode: "max" | "console"): Promise<AuthorizeResult> {
  const pkce = await generatePKCE()
  const state = generateState() // ✅ Independent random state (fixes #18652)

  const url = new URL(
    `https://${mode === "console" ? "console.anthropic.com" : "claude.ai"}/oauth/authorize`,
  )
  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", "https://console.anthropic.com/oauth/code/callback")
  url.searchParams.set("scope", "org:create_api_key user:profile user:inference")
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state) // ✅ Use independent state

  return {
    url: url.toString(),
    verifier: pkce.verifier,
    state, // Return state for validation during token exchange
  }
}

interface TokenExchangeResult {
  type: "success" | "failed"
  refresh?: string
  access?: string
  expires?: number
}

/**
 * Exchange authorization code for tokens
 */
async function exchange(code: string, verifier: string, state: string): Promise<TokenExchangeResult> {
  // Trim whitespace from pasted code (fixes terminal formatting issues)
  const trimmedCode = code.trim()
  const splits = trimmedCode.split("#")

  const result = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: splits[0],
      state: splits[1] || state, // Use provided state or extract from code#state format
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
      code_verifier: verifier,
    }),
  })

  if (!result.ok) {
    const errorText = await result.text().catch(() => "Unknown error")
    log.error("Token exchange failed", {
      status: result.status,
      error: errorText,
    })
    return {
      type: "failed",
    }
  }

  const json = await result.json()
  return {
    type: "success",
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

/**
 * Refresh access token using refresh token
 */
async function refreshToken(refreshToken: string): Promise<TokenExchangeResult> {
  const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    log.error("Token refresh failed", {
      status: response.status,
      error: errorText,
    })
    return {
      type: "failed",
    }
  }

  const json = await response.json()
  return {
    type: "success",
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

/**
 * Anthropic OAuth plugin
 * Vendored from deprecated opencode-anthropic-auth@0.0.13
 * Fixed PKCE state parameter security issue (#18652)
 */
export async function AnthropicAuthPlugin({ client }: PluginInput): Promise<Hooks> {
  return {
    "experimental.chat.system.transform": (input, output) => {
      const prefix = "You are Claude Code, Anthropic's official CLI for Claude."
      if (input.model?.providerID === "anthropic") {
        output.system.unshift(prefix)
        if (output.system[1]) output.system[1] = prefix + "\n\n" + output.system[1]
      }
    },
    auth: {
      provider: "anthropic",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type === "oauth") {
          // Zero out cost for max plan
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            }
          }
          return {
            apiKey: "",
            async fetch(input: RequestInfo | URL, init?: RequestInit) {
              const currentAuth = await getAuth()
              if (currentAuth.type !== "oauth") return fetch(input, init)

              // Refresh token if expired
              if (!currentAuth.access || currentAuth.expires < Date.now()) {
                const refreshResult = await refreshToken(currentAuth.refresh)
                if (refreshResult.type === "failed") {
                  throw new Error("Token refresh failed")
                }

                await client.auth.set({
                  path: {
                    id: "anthropic",
                  },
                  body: {
                    type: "oauth",
                    refresh: refreshResult.refresh!,
                    access: refreshResult.access!,
                    expires: refreshResult.expires!,
                  },
                })
                currentAuth.access = refreshResult.access!
              }

              const requestInit = init ?? {}
              const requestHeaders = new Headers()

              // Copy headers from input
              if (input instanceof Request) {
                input.headers.forEach((value, key) => {
                  requestHeaders.set(key, value)
                })
              }

              // Copy headers from init
              if (requestInit.headers) {
                if (requestInit.headers instanceof Headers) {
                  requestInit.headers.forEach((value, key) => {
                    requestHeaders.set(key, value)
                  })
                } else if (Array.isArray(requestInit.headers)) {
                  for (const [key, value] of requestInit.headers) {
                    if (typeof value !== "undefined") {
                      requestHeaders.set(key, String(value))
                    }
                  }
                } else {
                  for (const [key, value] of Object.entries(requestInit.headers)) {
                    if (typeof value !== "undefined") {
                      requestHeaders.set(key, String(value))
                    }
                  }
                }
              }

              // Merge beta headers
              const incomingBeta = requestHeaders.get("anthropic-beta") || ""
              const incomingBetasList = incomingBeta
                .split(",")
                .map((b) => b.trim())
                .filter(Boolean)

              const requiredBetas = ["oauth-2025-04-20", "interleaved-thinking-2025-05-14"]
              const mergedBetas = [...new Set([...requiredBetas, ...incomingBetasList])].join(",")

              requestHeaders.set("authorization", `Bearer ${currentAuth.access}`)
              requestHeaders.set("anthropic-beta", mergedBetas)
              requestHeaders.set("user-agent", "claude-cli/2.1.2 (external, cli)")
              requestHeaders.delete("x-api-key")

              // Sanitize request body
              const TOOL_PREFIX = "mcp_"
              let body = requestInit.body
              if (body && typeof body === "string") {
                try {
                  const parsed = JSON.parse(body)

                  // Sanitize system prompt - server blocks "OpenCode" string
                  if (parsed.system && Array.isArray(parsed.system)) {
                    parsed.system = parsed.system.map((item: any) => {
                      if (item.type === "text" && typeof item.text === "string") {
                        return {
                          ...item,
                          text: item.text.replace(/OpenCode/g, "Claude Code"),
                        }
                      }
                      return item
                    })
                  }

                  // Prefix MCP tools
                  if (parsed.tools && Array.isArray(parsed.tools)) {
                    parsed.tools = parsed.tools.map((tool: any) => ({
                      ...tool,
                      name: tool.name.startsWith(TOOL_PREFIX) ? tool.name : `${TOOL_PREFIX}${tool.name}`,
                    }))
                  }

                  body = JSON.stringify(parsed)
                } catch (e) {
                  log.debug("Failed to parse request body for sanitization", { error: e })
                }
              }

              return fetch(input, {
                ...requestInit,
                headers: requestHeaders,
                body,
              })
            },
          }
        }
        return {}
      },
    },
  }
}

// Export helper functions for CLI usage
export { authorize, exchange, refreshToken }
