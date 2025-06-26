import { Auth } from "./index.js"
import crypto from "crypto"

export namespace AuthGoogle {
  const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
  const CLIENT_SECRET = "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"
  const SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]

  interface OAuthCallbackResult {
    code: string
    state: string
  }

  export async function authorize() {
    // Find an available port
    const port = await findAvailablePort()
    const redirectUri = `http://localhost:${port}/oauth2callback`
    
    // Generate a random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex')
    
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.searchParams.set("client_id", CLIENT_ID)
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", SCOPES.join(" "))
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("state", state)
    url.searchParams.set("prompt", "consent") // Force consent to ensure refresh token
    
    return {
      url: url.toString(),
      state,
      port,
      redirectUri
    }
  }

  async function findAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
      const server = Bun.serve({
        port: 0, // Let Bun choose an available port
        fetch() {
          return new Response("Port check")
        },
      })
      const port = server.port
      server.stop()
      resolve(port!)
    })
  }

  export async function waitForCallback(state: string, port: number): Promise<OAuthCallbackResult> {
    return new Promise((resolve, reject) => {
      const server = Bun.serve({
        port,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/oauth2callback") {
            const code = url.searchParams.get("code")
            const receivedState = url.searchParams.get("state")
            
            if (code && receivedState === state) {
              setTimeout(() => {
                server.stop()
                resolve({ code, state: receivedState })
              }, 100)
              
              return Response.redirect("https://opencode.ai/docs/", 302)
            } else {              
              return new Response(JSON.stringify({ error: "Invalid or missing authorization code" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              })
            }
          }
          
          return new Response("Not Found", { status: 404 })
        },
      })
      
      // Timeout after 5 minutes
      setTimeout(() => {
        server.stop()
        reject(new Error("OAuth callback timeout"))
      }, 5 * 60 * 1000)
    })
  }

  export async function exchange(code: string, redirectUri: string) {
    const params = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })
    
    const result = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })
    
    if (!result.ok) {
      const error = await result.text()
      console.error("Google OAuth exchange failed:", error)
      throw new ExchangeFailed()
    }
    
    const json = await result.json()
    
    // Validate the token
    const tokenInfo = await validateToken(json.access_token)
    if (!tokenInfo) {
      throw new Error("Failed to validate access token")
    }
    
    await Auth.set("google", {
      type: "oauth",
      refresh: json.refresh_token as string,
      access: json.access_token as string,
      expires: Date.now() + json.expires_in * 1000,
    })
  }

  async function validateToken(accessToken: string): Promise<any> {
    const response = await fetch("https://oauth2.googleapis.com/tokeninfo", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    })
    
    if (!response.ok) {
      return null
    }
    
    return response.json()
  }

  export async function access() {
    const info = await Auth.get("google")
    if (!info || info.type !== "oauth") return
    
    // Return access token if it's still valid (with 5 minute buffer)
    if (info.access && info.expires > Date.now() + 5 * 60 * 1000) {
      return info.access
    }
    
    // Refresh the token
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: info.refresh,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    })
    
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })
    
    if (!response.ok) {
      console.error("Failed to refresh Google token")
      return
    }
    
    const json = await response.json()
    await Auth.set("google", {
      type: "oauth",
      refresh: info.refresh, // Keep the same refresh token
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