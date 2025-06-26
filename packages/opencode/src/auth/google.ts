import { generatePKCE } from "@openauthjs/openauth/pkce"
import { Auth } from "./index"
import { createServer } from "http"
import { URL } from "url"

export namespace AuthGoogle {
  const CLIENT_ID = process.env["GOOGLE_CLIENT_ID"] || ""
  const CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"] || ""
  const SCOPES = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"

  export async function authorize(): Promise<{ url: string; verifier: string; port: number }> {
    const pkce = await generatePKCE()
    const port = await getAvailablePort()
    const redirectUri = `http://localhost:${port}/oauth2callback`
    
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
        
        if (url.pathname === "/oauth2callback") {
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
    const redirectUri = `http://localhost:${port}/oauth2callback`
    
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
    await Auth.set("google", {
      type: "oauth",
      refresh: json.refresh_token as string,
      access: json.access_token as string,
      expires: Date.now() + json.expires_in * 1000,
    })
  }

  export async function access() {
    const info = await Auth.get("google")
    if (!info || info.type !== "oauth") return
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
    await Auth.set("google", {
      type: "oauth",
      refresh: info.refresh, // Google doesn't always return a new refresh token
      access: json.access_token as string,
      expires: Date.now() + json.expires_in * 1000,
    })
    
    return json.access_token as string
  }

  async function getAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
      const server = createServer()
      server.listen(0, () => {
        const address = server.address()
        const port = typeof address === 'object' ? address?.port : undefined
        server.close()
        resolve(port || 3000)
      })
    })
  }

  export class ExchangeFailed extends Error {
    constructor() {
      super("OAuth token exchange failed")
    }
  }
}