import { join } from "path"
import { homedir } from "os"
import { readFile, writeFile, mkdir } from "fs/promises"
import { fetch } from "bun"

interface GeminiCredentials {
  access_token: string
  refresh_token: string
  expiry_date: number
  _oauth_client_id?: string
  _oauth_client_secret?: string
  [key: string]: any
}

export class GeminiAuth {
  private credentials?: GeminiCredentials
  private credPath = join(homedir(), ".gemini", "oauth_creds.json")

  async getAccessToken(): Promise<string> {
    if (!this.credentials) {
      await this.loadoutCredentials()
    }

    if (!this.credentials) {
      throw new Error("Gemini credentials not found. Please login via Gemini CLI.")
    }

    if (Date.now() > this.credentials.expiry_date - 30000) {
      await this.refreshToken()
    }

    return this.credentials.access_token
  }

  private async loadoutCredentials() {
    try {
      const content = await readFile(this.credPath, "utf-8")
      this.credentials = JSON.parse(content)
    } catch (error) {
       // Ignore error if file doesn't exist, will be handled by getAccessToken
    }
  }

  private async refreshToken() {
    if (!this.credentials?.refresh_token) {
      throw new Error("No refresh token available for Gemini.")
    }

    const clientId = this.credentials._oauth_client_id
    const clientSecret = this.credentials._oauth_client_secret

    if (!clientId || !clientSecret) {
      throw new Error("OAuth client credentials not found in ~/.gemini/oauth_creds.json. Please re-login via Gemini CLI.")
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`Failed to refresh Gemini token: ${text}`)
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
        await mkdir(join(homedir(), ".gemini"), { recursive: true })
        await writeFile(this.credPath, JSON.stringify(this.credentials, null, 2))
    } catch (e) {
        console.error("Failed to save Gemini credentials", e)
    }
  }
}

export const geminiAuth = new GeminiAuth()
