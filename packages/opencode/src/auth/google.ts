import { generatePKCE } from "@openauthjs/openauth/pkce"
import { Auth } from "./index"
import { createServer } from "http"
import { URL } from "url"
import fs from "fs/promises"
import path from "path"
import os from "os"

interface OAuthCredentials {
  access_token: string
  refresh_token: string
  scope: string
  token_type: string
  expiry_date: number
}

export namespace AuthGoogle {
  // OAuth configuration from Gemini CLI
  const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
  const CLIENT_SECRET = "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"
  const SCOPES = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"

  const OAUTH_REDIRECT_PORT = 45289
  const OAUTH_CREDS_PATH = path.join(os.homedir(), ".gemini", "oauth_creds.json")
  
  // Code Assist API configuration
  const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
  const CODE_ASSIST_API_VERSION = "v1internal"

  export async function authorize(): Promise<{ url: string; verifier: string; port: number }> {
    const pkce = await generatePKCE()
    const port = OAUTH_REDIRECT_PORT
    const redirectUri = `http://localhost:${port}`
    
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.searchParams.set("client_id", CLIENT_ID)
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", SCOPES)
    url.searchParams.set("code_challenge", pkce.challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")
    url.searchParams.set("state", pkce.verifier)
    
    return {
      url: url.toString(),
      verifier: pkce.verifier,
      port
    }
  }

  export async function startCallbackServer(port: number, verifier: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${port}`)
        
        if (url.pathname === "/") {
          const code = url.searchParams.get("code")
          const state = url.searchParams.get("state")
          
          if (code && state === verifier) {
            res.writeHead(200, { "Content-Type": "text/html" })
            res.end(`
              <html>
                <body>
                  <h1>Authentication successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </body>
              </html>
            `)
            server.close()
            resolve(code)
          } else {
            res.writeHead(400, { "Content-Type": "text/html" })
            res.end(`
              <html>
                <body>
                  <h1>Authentication failed!</h1>
                  <p>Invalid or missing authorization code.</p>
                </body>
              </html>
            `)
            server.close()
            reject(new Error("Invalid or missing authorization code"))
          }
        } else {
          res.writeHead(404)
          res.end()
        }
      })
      
      server.listen(port)
      
      setTimeout(() => {
        server.close()
        reject(new Error("OAuth callback timeout"))
      }, 300000) // 5 minute timeout
    })
  }

  export async function exchange(code: string, port: number, verifier: string) {
    const redirectUri = `http://localhost:${port}`
    
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }).toString(),
    })
    
    if (!response.ok) {
      throw new ExchangeFailed()
    }
    
    const json = await response.json()
    
    // Save to both Auth system and Gemini CLI format
    await Auth.set("google", {
      type: "oauth",
      refresh: json.refresh_token as string,
      access: json.access_token as string,
      expires: Date.now() + json.expires_in * 1000,
    })
    
    // Save in Gemini CLI format
    await saveOAuthCredentials({
      access_token: json.access_token as string,
      refresh_token: json.refresh_token as string,
      scope: SCOPES,
      token_type: json.token_type || "Bearer",
      expiry_date: Date.now() + json.expires_in * 1000,
    })
  }

  export async function access() {
    // Try to load from Auth system first
    let info = await Auth.get("google")
    
    // If not found, try to load from Gemini CLI format
    if (!info || info.type !== "oauth") {
      const geminiCreds = await loadOAuthCredentials()
      if (!geminiCreds) return
      
      // Import Gemini CLI credentials to Auth system
      info = {
        type: "oauth",
        refresh: geminiCreds.refresh_token,
        access: geminiCreds.access_token,
        expires: geminiCreds.expiry_date,
      }
      await Auth.set("google", info)
    }
    
    if (info.access && info.expires > Date.now()) return info.access
    
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: info.refresh,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    })
    
    if (!response.ok) return
    
    const json = await response.json()
    const newExpiry = Date.now() + json.expires_in * 1000
    
    // Update both Auth system and Gemini CLI format
    await Auth.set("google", {
      type: "oauth",
      refresh: info.refresh, // Google doesn't always return a new refresh token
      access: json.access_token as string,
      expires: newExpiry,
    })
    
    // Update Gemini CLI format
    await saveOAuthCredentials({
      access_token: json.access_token as string,
      refresh_token: info.refresh,
      scope: SCOPES,
      token_type: json.token_type || "Bearer",
      expiry_date: newExpiry,
    })
    
    return json.access_token as string
  }


  async function saveOAuthCredentials(credentials: OAuthCredentials): Promise<void> {
    const dir = path.dirname(OAUTH_CREDS_PATH)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(OAUTH_CREDS_PATH, JSON.stringify(credentials, null, 2))
  }

  async function loadOAuthCredentials(): Promise<OAuthCredentials | null> {
    try {
      const data = await fs.readFile(OAUTH_CREDS_PATH, "utf8")
      return JSON.parse(data)
    } catch (err) {
      return null
    }
  }

  /**
   * Call a Code Assist API endpoint
   */
  export async function callCodeAssistEndpoint(method: string, body: any): Promise<any> {
    const accessToken = await access()
    if (!accessToken) {
      throw new Error("Not authenticated with Google. Please run 'auth login google' first.")
    }

    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Code Assist API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  /**
   * Discover or retrieve the project ID
   */
  export async function discoverProjectId(): Promise<string> {
    // Check common environment variables for Google Cloud project ID
    const envProjectId = process.env["GOOGLE_CLOUD_PROJECT"] || 
                        process.env["GCP_PROJECT"] || 
                        process.env["GCLOUD_PROJECT"]
    
    // Start with environment project ID if available, otherwise use a placeholder
    const initialProjectId = envProjectId || "opencode-oauth-project"

    // Prepare client metadata
    const clientMetadata = {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
      duetProject: initialProjectId,
    }

    try {
      // Call loadCodeAssist to discover the actual project ID
      const loadRequest = {
        cloudaicompanionProject: initialProjectId,
        metadata: clientMetadata,
      }

      const loadResponse = await callCodeAssistEndpoint("loadCodeAssist", loadRequest)

      // Check if we already have a project ID from the response
      if (loadResponse.cloudaicompanionProject) {
        return loadResponse.cloudaicompanionProject
      }

      // If no existing project, we need to onboard
      const defaultTier = loadResponse.allowedTiers?.find((tier: any) => tier.isDefault)
      const tierId = defaultTier?.id || "free-tier"

      const onboardRequest = {
        tierId: tierId,
        cloudaicompanionProject: initialProjectId,
        metadata: clientMetadata,
      }

      let lroResponse = await callCodeAssistEndpoint("onboardUser", onboardRequest)

      // Poll until operation is complete
      while (!lroResponse.done) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        lroResponse = await callCodeAssistEndpoint("onboardUser", onboardRequest)
      }

      const discoveredProjectId = lroResponse.response?.cloudaicompanionProject?.id || initialProjectId
      return discoveredProjectId
    } catch (error: any) {
      // Check if this is a permission error
      if (error.message?.includes("Permission denied") || error.message?.includes("403")) {
        console.error("Permission denied accessing Google Cloud project. This is likely because:")
        console.error("1. The project ID doesn't exist or you don't have access to it")
        console.error("2. You need to set up a Google Cloud project first")
        console.error("\nTo fix this, you can either:")
        console.error("- Set the GOOGLE_CLOUD_PROJECT environment variable to your existing project ID")
        console.error("- Let the system create a new project by proceeding with onboarding")
        
        // Try to onboard without a specific project ID
        if (!envProjectId) {
          try {
            // Retry with empty project ID to trigger new project creation
            const onboardRequest = {
              tierId: "free-tier",
              metadata: clientMetadata,
            }
            
            let lroResponse = await callCodeAssistEndpoint("onboardUser", onboardRequest)
            
            // Poll until operation is complete
            while (!lroResponse.done) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              lroResponse = await callCodeAssistEndpoint("onboardUser", onboardRequest)
            }
            
            const discoveredProjectId = lroResponse.response?.cloudaicompanionProject?.id
            if (discoveredProjectId) {
              return discoveredProjectId
            }
          } catch (onboardError: any) {
            console.error("Onboarding also failed:", onboardError.message)
          }
        }
      }
      
      console.error("Failed to discover project ID:", error.message)
      throw new Error(`Could not discover Google Cloud project ID. ${error.message}`)
    }
  }

  export class ExchangeFailed extends Error {
    constructor() {
      super("OAuth token exchange failed")
    }
  }
}