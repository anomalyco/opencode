import type { AuthOuathResult } from "@opencode-ai/plugin"
import { PKCE } from "@/oauth/pkce"
import type { ProviderAuthAdapter, ProviderAuthMethod } from "../adapter"

// OAuth configuration for Qwen device flow.
// These are placeholder development values - upstream may require registering
// an official OpenCode OAuth app with Alibaba Cloud before merging.
const DEVICE_CODE_URL = process.env["QWEN_DEVICE_CODE_ENDPOINT"] ?? "https://chat.qwen.ai/api/v1/oauth2/device/code"
const TOKEN_URL = process.env["QWEN_TOKEN_ENDPOINT"] ?? "https://chat.qwen.ai/api/v1/oauth2/token"
const CLIENT_ID = process.env["QWEN_CLIENT_ID"] ?? "f0304373b74a44d2b584a3fb70ca9e56"
const SCOPES = process.env["QWEN_SCOPES"] ?? "openid profile email model.completion"
const GRANT_TYPE_DEVICE = "urn:ietf:params:oauth:grant-type:device_code"

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

async function initiateDeviceFlow() {
  const verifier = PKCE.generateVerifier()
  const challenge = PKCE.challengeFromVerifier(verifier)

  const body = new URLSearchParams()
  body.set("client_id", CLIENT_ID)
  body.set("scope", SCOPES)
  body.set("code_challenge", challenge)
  body.set("code_challenge_method", "S256")

  const resp = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  })
  if (!resp.ok) throw new Error(`device_code_failed: HTTP ${resp.status}`)
  const json = (await resp.json()) as DeviceCodeResponse
  if (!json.device_code) throw new Error("device_code_failed: missing device_code")
  return { device: json, verifier }
}

async function pollForToken(args: { device: DeviceCodeResponse; verifier: string; maxWaitMs: number }) {
  let intervalMs = Math.max(1_000, args.device.interval * 1000)
  const deadline = Date.now() + Math.min(args.maxWaitMs, args.device.expires_in * 1000)

  while (Date.now() < deadline) {
    const body = new URLSearchParams()
    body.set("grant_type", GRANT_TYPE_DEVICE)
    body.set("client_id", CLIENT_ID)
    body.set("device_code", args.device.device_code)
    body.set("code_verifier", args.verifier)

    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    })

    const json = await resp.json().catch(() => ({}))
    if (resp.ok && (json as any)?.access_token) {
      const access = (json as any).access_token as string
      const refresh = ((json as any).refresh_token as string | undefined) ?? ""
      const expiresIn = (json as any)?.expires_in
      const expires = typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 60 * 1000
      return { access, refresh, expires }
    }

    const err = (json as any)?.error
    if (err === "authorization_pending") {
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }
    if (err === "slow_down") {
      intervalMs = Math.min(Math.floor(intervalMs * 1.5), 10_000)
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }
    if (err) throw new Error(`${err}: ${(json as any)?.error_description ?? ""}`)

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  throw new Error("timeout: device authorization timed out")
}

async function refreshAccessToken(refresh_token: string) {
  const body = new URLSearchParams()
  body.set("grant_type", "refresh_token")
  body.set("client_id", CLIENT_ID)
  body.set("refresh_token", refresh_token)

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  })

  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = (json as any)?.error ?? "refresh_failed"
    const desc = (json as any)?.error_description ?? resp.statusText
    throw new Error(`${err}: ${desc}`)
  }

  const access = (json as any)?.access_token
  const refresh = (json as any)?.refresh_token
  const expiresIn = (json as any)?.expires_in
  if (!access) throw new Error("refresh_failed: missing access_token")
  const expires = typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 60 * 1000
  return { access, refresh: refresh ?? refresh_token, expires }
}

export const QwenSubscriptionAdapter: ProviderAuthAdapter = {
  providerId: "qwen",

  authMethods(): ProviderAuthMethod[] {
    return [
      {
        type: "oauth",
        label: "Qwen (Device Login)",
        async authorize(): Promise<AuthOuathResult> {
          const { device, verifier } = await initiateDeviceFlow()
          const url = device.verification_uri_complete || device.verification_uri
          const instructions = `Enter code: ${device.user_code}`

          return {
            url,
            instructions,
            method: "auto",
            async callback() {
              try {
                const token = await pollForToken({ device, verifier, maxWaitMs: 15 * 60 * 1000 })
                return { type: "success", access: token.access, refresh: token.refresh, expires: token.expires }
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

  async refresh(secret: any) {
    const refresh = secret?.refreshToken
    if (!refresh) return secret
    const t = await refreshAccessToken(String(refresh))
    return { ...secret, accessToken: t.access, refreshToken: t.refresh, expiresAt: t.expires }
  },
}
