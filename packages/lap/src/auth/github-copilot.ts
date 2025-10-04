import z from "zod/v4"
import { Auth } from "./index"
import { NamedError } from "../util/error"

export namespace AuthGithubCopilot {
  const CLIENT_ID = "Iv1.b507a08c87ecfe98"
  const DEVICE_CODE_URL = "https://github.com/login/device/code"
  const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
  const COPILOT_API_KEY_URL = "https://api.github.com/copilot_internal/v2/token"

  interface DeviceCodeResponse {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }

  interface AccessTokenResponse {
    access_token?: string
    error?: string
    error_description?: string
  }

  interface CopilotTokenResponse {
    token: string
    expires_at: number
    refresh_in: number
    endpoints: {
      api: string
    }
  }

  export async function authorize() {
    const deviceResponse = await fetch(DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "GitHubCopilotChat/0.26.7",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: "read:user",
      }),
    })
    const deviceData: DeviceCodeResponse = await deviceResponse.json()
    return {
      device: deviceData.device_code,
      user: deviceData.user_code,
      verification: deviceData.verification_uri,
      interval: deviceData.interval || 5,
      expiry: deviceData.expires_in,
    }
  }

  export async function poll(device_code: string) {
    const response = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "GitHubCopilotChat/0.26.7",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })

    if (!response.ok) return "failed"

    const data: AccessTokenResponse = await response.json()

    if (data.access_token) {
      // Store the GitHub OAuth token
      await Auth.set("github-copilot", {
        type: "oauth",
        refresh: data.access_token,
        access: "",
        expires: 0,
      })
      return "complete"
    }

    if (data.error === "authorization_pending") return "pending"

    if (data.error) return "failed"

    return "pending"
  }

  export async function access() {
    const info = await Auth.get("github-copilot")
    if (!info || info.type !== "oauth") return
    if (info.access && info.expires > Date.now()) return info.access

    // Get new Copilot API token
    const response = await fetch(COPILOT_API_KEY_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${info.refresh}`,
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "Editor-Version": "vscode/1.99.3",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
      },
    })

    if (!response.ok) return

    const tokenData: CopilotTokenResponse = await response.json()

    // Store the Copilot API token
    await Auth.set("github-copilot", {
      type: "oauth",
      refresh: info.refresh,
      access: tokenData.token,
      expires: tokenData.expires_at * 1000,
    })

    return tokenData.token
  }

  export const DeviceCodeError = NamedError.create("DeviceCodeError", z.object({}))

  export const TokenExchangeError = NamedError.create(
    "TokenExchangeError",
    z.object({
      message: z.string(),
    }),
  )

  export const AuthenticationError = NamedError.create(
    "AuthenticationError",
    z.object({
      message: z.string(),
    }),
  )

  export const CopilotTokenError = NamedError.create(
    "CopilotTokenError",
    z.object({
      message: z.string(),
    }),
  )
}
