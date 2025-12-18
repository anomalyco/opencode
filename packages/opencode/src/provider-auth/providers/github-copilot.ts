import type { AuthOuathResult } from "@opencode-ai/plugin"
import type { ProviderAuthAdapter, ProviderAuthMethod } from "../adapter"

// OAuth configuration for GitHub Copilot device flow.
// These are placeholder development values - upstream may require registering
// an official OpenCode OAuth app with GitHub before merging.
const CLIENT_ID = process.env["COPILOT_CLIENT_ID"] ?? "Iv1.b507a08c87ecfe98"
const DEVICE_CODE_URL = process.env["COPILOT_DEVICE_CODE_URL"] ?? "https://github.com/login/device/code"
const TOKEN_URL = process.env["COPILOT_TOKEN_URL"] ?? "https://github.com/login/oauth/access_token"
const COPILOT_API_TOKEN_URL = process.env["COPILOT_API_TOKEN_URL"] ?? "https://api.github.com/copilot_internal/v2/token"
const SCOPE = process.env["COPILOT_SCOPE"] ?? "user:email"

const COPILOT_EDITOR_VERSION = process.env["COPILOT_EDITOR_VERSION"] ?? "vscode/1.85.1"
const COPILOT_EDITOR_PLUGIN_VERSION = process.env["COPILOT_EDITOR_PLUGIN_VERSION"] ?? "copilot/1.155.0"
const COPILOT_USER_AGENT = process.env["COPILOT_USER_AGENT"] ?? "GithubCopilot/1.155.0"

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type CopilotApiTokenResponse = {
  token?: string
  expires_at?: number
  endpoints?: {
    api?: string
    [k: string]: unknown
  }
  [k: string]: unknown
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams()
  body.set("client_id", CLIENT_ID)
  body.set("scope", SCOPE)

  const resp = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  })
  if (!resp.ok) throw new Error(`device_code_failed: HTTP ${resp.status}`)
  return (await resp.json()) as DeviceCodeResponse
}

async function pollForToken(device: DeviceCodeResponse, timeoutMs: number = 15 * 60 * 1000): Promise<{ access: string }> {
  const deadline = Date.now() + Math.min(timeoutMs, device.expires_in * 1000)
  let intervalMs = Math.max(5_000, device.interval * 1000)

  while (Date.now() < deadline) {
    const body = new URLSearchParams()
    body.set("client_id", CLIENT_ID)
    body.set("device_code", device.device_code)
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")

    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    })

    const json = await resp.json().catch(() => ({}))
    const err = (json as any)?.error
    if (err === "authorization_pending") {
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }
    if (err === "slow_down") {
      intervalMs += 5_000
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }
    if (err) throw new Error(`${err}: ${(json as any)?.error_description ?? ""}`)

    const access = (json as any)?.access_token
    if (access) return { access }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  throw new Error("timeout: device authorization timed out")
}

function defaultCopilotHeaders(githubAccessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "editor-version": COPILOT_EDITOR_VERSION,
    "editor-plugin-version": COPILOT_EDITOR_PLUGIN_VERSION,
    "user-agent": COPILOT_USER_AGENT,
    "accept-encoding": "gzip,deflate,br",
  }
  if (githubAccessToken) headers["authorization"] = `token ${githubAccessToken}`
  return headers
}

async function exchangeForCopilotToken(githubAccessToken: string): Promise<{
  copilotToken: string
  expiresAtMs: number
  endpoints?: CopilotApiTokenResponse["endpoints"]
}> {
  const resp = await fetch(COPILOT_API_TOKEN_URL, {
    method: "GET",
    headers: defaultCopilotHeaders(githubAccessToken),
  })
  const json = (await resp.json().catch(() => ({}))) as CopilotApiTokenResponse

  if (!resp.ok) {
    throw new Error(`copilot_token_failed: HTTP ${resp.status}`)
  }

  const token = json.token
  if (!token) throw new Error("copilot_token_failed: missing token")

  const expiresAtMs =
    typeof json.expires_at === "number" && Number.isFinite(json.expires_at)
      ? Math.floor(json.expires_at * 1000)
      : Date.now() + 60 * 60 * 1000

  return {
    copilotToken: token,
    expiresAtMs,
    endpoints: json.endpoints,
  }
}

export const GitHubCopilotSubscriptionAdapter: ProviderAuthAdapter = {
  providerId: "github-copilot",

  authMethods(): ProviderAuthMethod[] {
    return [
      {
        type: "oauth",
        label: "GitHub Copilot (Device Login)",
        async authorize(): Promise<AuthOuathResult> {
          const device = await requestDeviceCode()
          const url = device.verification_uri
          const instructions = `Enter code: ${device.user_code}`

          return {
            url,
            instructions,
            method: "auto",
            async callback() {
              try {
                const github = await pollForToken(device)
                // GitHub Copilot uses a derived token for inference.
                const copilot = await exchangeForCopilotToken(github.access)
                return {
                  type: "success",
                  access: copilot.copilotToken,
                  // Store GitHub token as the refresh token so we can derive new copilot tokens on-demand.
                  refresh: github.access,
                  expires: copilot.expiresAtMs,
                  endpoints: copilot.endpoints,
                }
              } catch {
                return { type: "failed" }
              }
            },
          } as AuthOuathResult
        },
      },
    ]
  },

  prepareRequest({ url, secret }) {
    const api = (secret as any)?.extra?.endpoints?.api
    if (typeof api !== "string" || !api) return
    try {
      const base = new URL(api)
      url.protocol = base.protocol
      url.host = base.host

      const prefix = base.pathname && base.pathname !== "/" ? base.pathname.replace(/\/$/, "") : ""
      if (prefix) {
        const existing = url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`
        url.pathname = `${prefix}${existing}`
      }
    } catch {
      // ignore invalid endpoint
    }
  },

  applyAuth(headers: Headers, secret: any) {
    if (secret && typeof secret === "object" && "accessToken" in secret) {
      headers.set("Authorization", `Bearer ${String((secret as any).accessToken)}`)
      if (!headers.has("accept")) headers.set("accept", "application/json")
      if (!headers.has("editor-version")) headers.set("editor-version", COPILOT_EDITOR_VERSION)
      if (!headers.has("editor-plugin-version")) headers.set("editor-plugin-version", COPILOT_EDITOR_PLUGIN_VERSION)
      if (!headers.has("user-agent")) headers.set("user-agent", COPILOT_USER_AGENT)
    }
  },

  async refresh(secret: any) {
    const githubToken = secret?.refreshToken
    if (!githubToken) return secret
    const copilot = await exchangeForCopilotToken(String(githubToken))
    return {
      ...secret,
      accessToken: copilot.copilotToken,
      expiresAt: copilot.expiresAtMs,
      extra: {
        ...(secret?.extra ?? {}),
        endpoints: copilot.endpoints ?? (secret?.extra?.endpoints ?? undefined),
      },
    }
  },
}
