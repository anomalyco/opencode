import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"

// This client ID is specifically for Copilot and grants access to the usage API
// It's different from OpenCode's OAuth client ID
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"
const COPILOT_SCOPE = "read:user"

export interface CopilotUsageToken {
  accessToken: string
  scope?: string
  createdAt: string
}

export interface CopilotDeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface AccessTokenResponse {
  access_token: string
  token_type: string
  scope: string
}

interface ErrorResponse {
  error: string
  error_description?: string
}

function tokenFilePath(): string {
  return path.join(Global.Path.data, "usage-copilot.json")
}

export async function loadCopilotUsageToken(): Promise<CopilotUsageToken | null> {
  try {
    const data = await fs.readFile(tokenFilePath(), "utf8")
    const parsed = JSON.parse(data) as CopilotUsageToken
    if (!parsed.accessToken) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveCopilotUsageToken(token: CopilotUsageToken): Promise<void> {
  const filePath = tokenFilePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(token, null, 2), "utf8")
}

export async function requestCopilotDeviceCode(): Promise<CopilotDeviceCode> {
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode({
      client_id: COPILOT_CLIENT_ID,
      scope: COPILOT_SCOPE,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Copilot device code request failed (${response.status}): ${body || response.statusText}`)
  }

  const data = (await response.json()) as DeviceCodeResponse
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

export async function pollCopilotAccessToken(options: {
  deviceCode: string
  interval: number
  expiresIn: number
  onPending?: () => void
}): Promise<AccessTokenResponse> {
  const deadline = Date.now() + options.expiresIn * 1000
  let intervalMs = Math.max(1, options.interval) * 1000

  while (Date.now() < deadline) {
    await Bun.sleep(intervalMs)
    options.onPending?.()

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formEncode({
        client_id: COPILOT_CLIENT_ID,
        device_code: options.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    })

    const data = (await response.json()) as AccessTokenResponse | ErrorResponse

    if ("access_token" in data) {
      return data
    }

    if (data.error === "authorization_pending") {
      continue
    }

    if (data.error === "slow_down") {
      intervalMs += 5000
      continue
    }

    if (data.error === "expired_token") {
      throw new Error("Copilot device code expired")
    }

    throw new Error(data.error_description ?? data.error ?? "Copilot device flow failed")
  }

  throw new Error("Copilot device flow timed out")
}

function formEncode(params: Record<string, string>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value)
  }
  return search.toString()
}
