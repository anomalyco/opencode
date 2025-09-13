import z from "zod/v4"
import { Auth } from "./index"
import { NamedError } from "../util/error"
import { Config } from "../config/config"
import { normalizeDomain } from "../util/url"

export namespace AuthGithubCopilot {
  const CLIENT_ID = "Iv1.b507a08c87ecfe98"

  async function getBaseUrl(providerID: string, enterpriseUrl?: string): Promise<string> {
    if (enterpriseUrl) return normalizeDomain(enterpriseUrl)

    const config = await Config.get()
    const providerConfig = config.provider?.[providerID]
    const configUrl = providerConfig?.options?.githubEnterpriseUrl

    return configUrl ? normalizeDomain(configUrl) : "github.com"
  }

  async function getUrls(providerID = "github-copilot", enterpriseUrl?: string) {
    const baseUrl = await getBaseUrl(providerID, enterpriseUrl)

    return {
      DEVICE_CODE_URL: `https://${baseUrl}/login/device/code`,
      ACCESS_TOKEN_URL: `https://${baseUrl}/login/oauth/access_token`,
      COPILOT_API_KEY_URL: `https://api.${baseUrl}/copilot_internal/v2/token`,
    }
  }

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

  export async function authorize(providerID = "github-copilot", enterpriseUrl?: string) {
    const urls = await getUrls(providerID, enterpriseUrl)
    const deviceResponse = await fetch(urls.DEVICE_CODE_URL, {
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

  export async function poll(device_code: string, providerID = "github-copilot", enterpriseUrl?: string) {
    const urls = await getUrls(providerID, enterpriseUrl)
    const response = await fetch(urls.ACCESS_TOKEN_URL, {
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
      await Auth.set(providerID, {
        type: "oauth",
        refresh: data.access_token,
        access: "",
        expires: 0,
        ...(providerID === "github-copilot-enterprise" && enterpriseUrl ? { enterpriseUrl } : {}),
      })
      return "complete"
    }

    if (data.error === "authorization_pending") return "pending"

    if (data.error) return "failed"

    return "pending"
  }

  export async function access(providerID = "github-copilot") {
    const info = await Auth.get(providerID)
    if (!info || info.type !== "oauth") return
    if (info.access && info.expires > Date.now()) return info.access

    const urls = await getUrls(providerID, info.enterpriseUrl)
    const response = await fetch(urls.COPILOT_API_KEY_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${info.refresh}`,
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "Editor-Version": "vscode/1.103.2",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
      },
    })

    if (!response.ok) return

    const tokenData: CopilotTokenResponse = await response.json()

    // Store the Copilot API token, preserving all existing auth data
    await Auth.set(providerID, {
      ...info,
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
