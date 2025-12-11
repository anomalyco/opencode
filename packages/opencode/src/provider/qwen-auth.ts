import { join } from "path"
import { homedir } from "os"
import { readFile, writeFile, mkdir } from "fs/promises"
import { fetch } from "bun"

const QWEN_OAUTH_TOKEN_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/token"

interface QwenCredentials {
  access_token: string
  refresh_token: string
  expiry_date: number
  client_id?: string
  resource_url?: string
  [key: string]: any
}

export class QwenAuth {
  private credentials?: QwenCredentials
  private credPath = join(homedir(), ".qwen", "oauth_creds.json")

  async getAccessToken(): Promise<string> {
    if (!this.credentials) {
      await this.loadCredentials()
    }

    if (!this.credentials) {
      throw new Error("Qwen credentials not found. Please login via Qwen CLI.")
    }

    if (Date.now() > this.credentials.expiry_date - 30000) {
      await this.refreshToken()
    }

    return this.credentials.access_token
  }

  async getBaseURL(): Promise<string> {
    if (!this.credentials) {
      await this.loadCredentials()
    }
    const url = this.credentials?.resource_url || "https://dashscope.aliyuncs.com/compatible-mode/v1"
    if (!url.startsWith("http")) return `https://${url}/v1`
    return url.endsWith("/v1") ? url : `${url}/v1`
  }

  private async loadCredentials() {
    try {
      const content = await readFile(this.credPath, "utf-8")
      this.credentials = JSON.parse(content)
    } catch (error) {
      // Ignore
    }
  }

  private async refreshToken() {
    if (!this.credentials?.refresh_token) {
      throw new Error("No refresh token available for Qwen.")
    }

    const clientId = this.credentials.client_id
    if (!clientId) {
      throw new Error("OAuth client_id not found in ~/.qwen/oauth_creds.json. Please re-login via Qwen CLI.")
    }

    const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://chat.qwen.ai",
        "Referer": "https://chat.qwen.ai/",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refresh_token,
        client_id: clientId,
      }),
    })

    if (!response.ok) {
         const text = await response.text()
         throw new Error(`Failed to refresh Qwen token: ${text}`)
    }

    const data = await response.json()
    this.credentials.access_token = data.access_token
    this.credentials.expiry_date = Date.now() + (data.expires_in || 3600) * 1000
    if (data.refresh_token) {
      this.credentials.refresh_token = data.refresh_token
    }

    await this.saveCredentials()
  }

  private async saveCredentials() {
    if (!this.credentials) return
    try {
        await mkdir(join(homedir(), ".qwen"), { recursive: true })
        await writeFile(this.credPath, JSON.stringify(this.credentials, null, 2))
    } catch (e) {
        console.error("Failed to save Qwen credentials", e)
    }
  }
}

export const qwenAuth = new QwenAuth()
