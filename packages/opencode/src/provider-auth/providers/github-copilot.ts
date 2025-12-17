import type { AuthOuathResult } from "@opencode-ai/plugin"
import type { ProviderAuthAdapter, ProviderAuthMethod } from "../adapter"

const CLIENT_ID = process.env["COPILOT_CLIENT_ID"] ?? "Iv1.b507a08c87ecfe98"
const DEVICE_CODE_URL = process.env["COPILOT_DEVICE_CODE_URL"] ?? "https://github.com/login/device/code"
const TOKEN_URL = process.env["COPILOT_TOKEN_URL"] ?? "https://github.com/login/oauth/access_token"
const SCOPE = process.env["COPILOT_SCOPE"] ?? "user:email"

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
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
                const token = await pollForToken(device)
                // Copilot device flow does not provide refresh token.
                return { type: "success", access: token.access, refresh: "", expires: Date.now() + 60 * 60 * 1000 }
              } catch {
                return { type: "failed" }
              }
            },
          } as AuthOuathResult
        },
      },
    ]
  },

  applyAuth(headers: Headers, secret: any) {
    if (secret && typeof secret === "object" && "accessToken" in secret) {
      headers.set("Authorization", `Bearer ${String((secret as any).accessToken)}`)
    }
  },
}

