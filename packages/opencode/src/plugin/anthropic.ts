import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Log } from "../util/log"
import { createHash, randomBytes } from "node:crypto"
import { execSync } from "node:child_process"

const log = Log.create({ service: "plugin.anthropic" })

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const TOKEN_ENDPOINT = "https://console.anthropic.com/v1/oauth/token"
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
const TOOL_PREFIX = "mcp_"

interface PkceCodes {
  verifier: string
  challenge: string
}

/**
 * Generate PKCE codes using Node.js crypto.
 *
 * Uses crypto.randomBytes + digest("base64url") which produces unpadded
 * base64url per RFC 7636. The original plugin used jose's base64url.encode()
 * which includes '=' padding — Anthropic's server rejects padded challenges.
 */
function generatePKCE(): PkceCodes {
  const verifier = randomBytes(64).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

interface CurlResponse {
  status: number
  body: string
}

/**
 * Exchange tokens via curl subprocess instead of fetch().
 *
 * Bun's fetch() injects User-Agent, Origin, Referer, and Sec-Fetch-*
 * headers automatically. Anthropic's OAuth token endpoint rate-limits
 * requests carrying these extra headers (HTTP 429). curl only sends
 * exactly the headers we specify.
 */
function curlTokenExchange(payload: Record<string, string>): CurlResponse {
  const json = JSON.stringify(payload)
  const escaped = json.replace(/'/g, "'\\''")
  const result = execSync(
    `curl -s -w '\\n__HTTP_STATUS__%{http_code}' -X POST '${TOKEN_ENDPOINT}' ` +
      `-H 'Content-Type: application/json' ` +
      `-H 'User-Agent: claude-cli/2.1.2 (external, cli)' ` +
      `-H 'anthropic-client-type: claude-code' ` +
      `-d '${escaped}'`,
    { timeout: 30000, encoding: "utf8" },
  )
  const parts = result.split("\n__HTTP_STATUS__")
  const status = parseInt(parts[parts.length - 1])
  const bodyText = parts.slice(0, -1).join("\n__HTTP_STATUS__")
  return { status, body: bodyText }
}

function buildAuthorizeUrl(mode: "max" | "console", pkce: PkceCodes): { url: string; verifier: string } {
  const host = mode === "console" ? "console.anthropic.com" : "claude.ai"
  const url = new URL(`https://${host}/oauth/authorize`)
  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", REDIRECT_URI)
  url.searchParams.set("scope", "org:create_api_key user:profile user:inference")
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", pkce.verifier)
  return { url: url.toString(), verifier: pkce.verifier }
}

/**
 * Extract the authorization code from user input.
 *
 * The callback page returns `<code>#<state>` but users may paste the
 * full string. Strip everything after '#' and handle URL-formatted
 * codes as well.
 */
function extractCode(raw: string): string {
  let code = raw.trim()
  if (code.includes("#")) {
    code = code.split("#")[0]
  }
  if (code.includes("?")) {
    try {
      const url = new URL(code)
      code = url.searchParams.get("code") || code
    } catch {
      const match = code.match(/[?&]code=([^&#]+)/)
      if (match) code = match[1]
    }
  }
  return code.trim()
}

interface TokenResult {
  type: "success"
  refresh: string
  access: string
  expires: number
}

interface TokenFailed {
  type: "failed"
}

function exchangeCode(code: string, verifier: string): TokenResult | TokenFailed {
  const cleanCode = extractCode(code)
  try {
    const { status, body } = curlTokenExchange({
      code: cleanCode,
      state: verifier,
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    })
    if (status !== 200) {
      log.error("token exchange failed", { status, body })
      return { type: "failed" }
    }
    const json = JSON.parse(body)
    return {
      type: "success",
      refresh: json.refresh_token,
      access: json.access_token,
      expires: Date.now() + json.expires_in * 1000,
    }
  } catch (err) {
    log.error("token exchange error", { error: err instanceof Error ? err.message : String(err) })
    return { type: "failed" }
  }
}

function refreshToken(refresh: string): { access: string; refresh: string; expires: number } {
  const { status, body } = curlTokenExchange({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: CLIENT_ID,
  })
  if (status !== 200) {
    throw new Error(`Token refresh failed (${status}): ${body}`)
  }
  const json = JSON.parse(body)
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

export async function AnthropicAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const prefix = "You are Claude Code, Anthropic's official CLI for Claude."
      if (_input.model?.providerID === "anthropic") {
        output.system.unshift(prefix)
        if (output.system[1]) output.system[1] = prefix + "\n\n" + output.system[1]
      }
    },
    auth: {
      provider: "anthropic",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type === "oauth") {
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: { read: 0, write: 0 },
            }
          }
          return {
            apiKey: "",
            async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
              const currentAuth = await getAuth()
              if (currentAuth.type !== "oauth") return fetch(requestInput, init)

              if (!currentAuth.access || currentAuth.expires < Date.now()) {
                log.info("refreshing anthropic access token")
                const tokens = refreshToken(currentAuth.refresh)
                await input.client.auth.set({
                  path: { id: "anthropic" },
                  body: {
                    type: "oauth",
                    refresh: tokens.refresh,
                    access: tokens.access,
                    expires: tokens.expires,
                  },
                })
                currentAuth.access = tokens.access
              }

              const headers = new Headers()
              if (requestInput instanceof Request) {
                requestInput.headers.forEach((value, key) => headers.set(key, value))
              }
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

              const incomingBeta = headers.get("anthropic-beta") || ""
              const incomingBetas = incomingBeta
                .split(",")
                .map((b) => b.trim())
                .filter(Boolean)
              const requiredBetas = ["oauth-2025-04-20", "interleaved-thinking-2025-05-14"]
              const mergedBetas = [...new Set([...requiredBetas, ...incomingBetas])].join(",")

              headers.set("authorization", `Bearer ${currentAuth.access}`)
              headers.set("anthropic-beta", mergedBetas)
              headers.set("user-agent", "claude-cli/2.1.2 (external, cli)")
              headers.delete("x-api-key")

              let body = init?.body
              if (body && typeof body === "string") {
                try {
                  const parsed = JSON.parse(body)

                  if (parsed.system && Array.isArray(parsed.system)) {
                    parsed.system = parsed.system.map((item: any) => {
                      if (item.type === "text" && item.text) {
                        return {
                          ...item,
                          text: item.text.replace(/OpenCode/g, "Claude Code").replace(/opencode/gi, "Claude"),
                        }
                      }
                      return item
                    })
                  }

                  if (parsed.tools && Array.isArray(parsed.tools)) {
                    parsed.tools = parsed.tools.map((tool: any) => ({
                      ...tool,
                      name: tool.name ? `${TOOL_PREFIX}${tool.name}` : tool.name,
                    }))
                  }

                  if (parsed.messages && Array.isArray(parsed.messages)) {
                    parsed.messages = parsed.messages.map((msg: any) => {
                      if (msg.content && Array.isArray(msg.content)) {
                        msg.content = msg.content.map((block: any) => {
                          if (block.type === "tool_use" && block.name) {
                            return { ...block, name: `${TOOL_PREFIX}${block.name}` }
                          }
                          return block
                        })
                      }
                      return msg
                    })
                  }

                  body = JSON.stringify(parsed)
                } catch {
                  // ignore parse errors
                }
              }

              let finalInput: RequestInfo | URL = requestInput
              try {
                const requestUrl =
                  requestInput instanceof URL
                    ? requestInput
                    : new URL(typeof requestInput === "string" ? requestInput : (requestInput as Request).url)
                if (requestUrl.pathname === "/v1/messages" && !requestUrl.searchParams.has("beta")) {
                  requestUrl.searchParams.set("beta", "true")
                  finalInput =
                    requestInput instanceof Request ? new Request(requestUrl.toString(), requestInput) : requestUrl
                }
              } catch {
                // ignore URL parse errors
              }

              const response = await fetch(finalInput, {
                ...init,
                body,
                headers,
              })

              if (response.body) {
                const reader = response.body.getReader()
                const decoder = new TextDecoder()
                const encoder = new TextEncoder()
                const stream = new ReadableStream({
                  async pull(controller) {
                    const { done, value } = await reader.read()
                    if (done) {
                      controller.close()
                      return
                    }
                    let text = decoder.decode(value, { stream: true })
                    text = text.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"')
                    controller.enqueue(encoder.encode(text))
                  },
                })
                return new Response(stream, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              }

              return response
            },
          }
        }
        return {}
      },
      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth",
          authorize: async () => {
            const pkce = generatePKCE()
            const { url, verifier } = buildAuthorizeUrl("max", pkce)
            return {
              url,
              instructions: "Paste the authorization code here: ",
              method: "code" as const,
              callback: async (code: string) => exchangeCode(code, verifier),
            }
          },
        },
        {
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const pkce = generatePKCE()
            const { url, verifier } = buildAuthorizeUrl("console", pkce)
            return {
              url,
              instructions: "Paste the authorization code here: ",
              method: "code" as const,
              callback: async (code: string) => {
                const credentials = exchangeCode(code, verifier)
                if (credentials.type === "failed") return credentials
                const result = await fetch("https://api.anthropic.com/api/oauth/claude_cli/create_api_key", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    authorization: `Bearer ${credentials.access}`,
                  },
                }).then((r) => r.json() as Promise<{ raw_key: string }>)
                return { type: "success" as const, key: result.raw_key }
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
  }
}
