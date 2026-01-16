import { generatePKCE } from "@openauthjs/openauth/pkce"
import { Auth } from "./index"
import path from "path"
import os from "os"

export namespace AuthAnthropic {
  const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

  // Bridge to Claude Code credentials for EXACT auth parity
  // Claude Code stores OAuth tokens with user:sessions:claude_code scope
  // which is required for API access via subscription
  interface ClaudeCodeCredentials {
    claudeAiOauth?: {
      accessToken: string
      refreshToken: string
      expiresAt: number
      scopes: string[]
      subscriptionType?: string
    }
  }

  async function getClaudeCodeCredentials(): Promise<ClaudeCodeCredentials | null> {
    try {
      const credPath = path.join(os.homedir(), ".claude", ".credentials.json")
      const file = Bun.file(credPath)
      if (!(await file.exists())) return null
      return await file.json()
    } catch {
      return null
    }
  }

  export async function authorize(mode: "max" | "console") {
    const pkce = await generatePKCE()

    const url = new URL(
      `https://${mode === "console" ? "console.anthropic.com" : "claude.ai"}/oauth/authorize`,
      import.meta.url,
    )
    url.searchParams.set("code", "true")
    url.searchParams.set("client_id", CLIENT_ID)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", "https://console.anthropic.com/oauth/code/callback")
    url.searchParams.set("scope", "org:create_api_key user:profile user:inference")
    url.searchParams.set("code_challenge", pkce.challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", pkce.verifier)
    return {
      url: url.toString(),
      verifier: pkce.verifier,
    }
  }

  export async function exchange(code: string, verifier: string) {
    const splits = code.split("#")
    const result = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: splits[0],
        state: splits[1],
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        redirect_uri: "https://console.anthropic.com/oauth/code/callback",
        code_verifier: verifier,
      }),
    })
    if (!result.ok) throw new ExchangeFailed()
    const json = await result.json()
    return {
      refresh: json.refresh_token as string,
      access: json.access_token as string,
      expires: Date.now() + json.expires_in * 1000,
    }
  }

  export async function access() {
    // PRIORITY 1: Bridge to Claude Code credentials (exact same auth)
    // This uses the user:sessions:claude_code scope that Claude Code has
    const claudeCodeCreds = await getClaudeCodeCredentials()
    if (claudeCodeCreds?.claudeAiOauth) {
      const oauth = claudeCodeCreds.claudeAiOauth
      // Check if token is still valid (with 60s buffer)
      if (oauth.accessToken && oauth.expiresAt > Date.now() + 60000) {
        return oauth.accessToken
      }
      // Token expired - try to refresh using Claude Code's refresh token
      if (oauth.refreshToken) {
        try {
          const response = await fetch("https://claude.ai/api/auth/oauth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: oauth.refreshToken }),
          })
          if (response.ok) {
            const json = await response.json()
            // Note: We can't write back to Claude Code's credentials file
            // but we can use the refreshed token for this session
            return json.access_token as string
          }
        } catch {
          // Fall through to OpenCode auth
        }
      }
    }

    // PRIORITY 2: OpenCode's own OAuth tokens
    const info = await Auth.get("anthropic")
    if (!info || info.type !== "oauth") return
    if (info.access && info.expires > Date.now()) return info.access
    const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: info.refresh,
        client_id: CLIENT_ID,
      }),
    })
    if (!response.ok) return
    const json = await response.json()
    await Auth.set("anthropic", {
      type: "oauth",
      refresh: json.refresh_token as string,
      access: json.access_token as string,
      expires: Date.now() + json.expires_in * 1000,
    })
    return json.access_token as string
  }

  export class ExchangeFailed extends Error {
    constructor() {
      super("Exchange failed")
    }
  }
}
