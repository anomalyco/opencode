/**
 * OIDC Authentication for ANR OpenCode
 * Follows the Go app's OIDC flow with PKCE for Cognito authentication
 */

import { createServer, IncomingMessage, ServerResponse } from "http"
import { randomBytes } from "crypto"
import { createHash } from "crypto"
import { exec } from "child_process"
import { promisify } from "util"
import type { ANRConfig } from "../config/types"

const execAsync = promisify(exec)

export interface OIDCTokens {
  idToken: string
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

function generateRandomString(bytes: number): string {
  return randomBytes(bytes).toString("base64url")
}

function computeCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

async function openBrowser(url: string): Promise<void> {
  const { platform } = await import("os")
  const os = platform()

  if (os === "darwin") {
    try {
      await execAsync(`open "${url}"`)
    } catch (err) {
      console.error(`Could not open browser: ${err}`)
      console.log(`\nPlease open this URL manually:\n${url}`)
    }
    return
  }

  if (os === "win32") {
    try {
      await execAsync(`start "" "${url}"`)
    } catch (err) {
      console.error(`Could not open browser: ${err}`)
      console.log(`\nPlease open this URL manually:\n${url}`)
    }
    return
  }

  // Linux: try common openers in order
  const cmds = ["xdg-open", "sensible-browser", "x-www-browser", "gnome-open", "kde-open"]
  for (const cmd of cmds) {
    try {
      await execAsync(`${cmd} "${url}"`)
      return
    } catch {
      // try next
    }
  }

  console.error("Could not open browser automatically.")
  console.log(`\nPlease open this URL manually:\n${url}`)
}

export async function authenticateWithOIDC(config: ANRConfig): Promise<OIDCTokens> {
  const redirectPort = 8400
  const redirectURI = `http://localhost:${redirectPort}/callback`

  // Generate PKCE parameters
  const state = generateRandomString(16)
  const nonce = generateRandomString(16)
  const codeVerifier = generateRandomString(32)
  const codeChallenge = computeCodeChallenge(codeVerifier)

  // Build authorization URL
  const domain = config.providerDomain
  const baseURL = `https://${domain}`

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectURI,
    state: state,
    nonce: nonce,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  })

  const authURL = `${baseURL}/oauth2/authorize?${params.toString()}`

  console.log(`🌐 Opening browser for authentication...`)
  const isDesktop = process.env.OPENCODE_CLIENT === "desktop"

  // Set up callback server
  let callbackCode: string | null = null
  let callbackError: string | null = null
  let serverReady = false
  let clientConnected = false

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.writeHead(400)
      res.end("Bad request")
      return
    }

    if (req.url.startsWith("/callback")) {
      clientConnected = true
      const url = new URL(req.url, `http://localhost:${redirectPort}`)
      const code = url.searchParams.get("code")
      const returnedState = url.searchParams.get("state")
      const error = url.searchParams.get("error")

      if (error) {
        callbackError = url.searchParams.get("error_description") || error
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(
          `<html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>Authentication Failed</h1>
            <p>${callbackError}</p>
            <p>Return to your terminal to continue.</p>
          </body></html>`,
        )
        return
      }

      if (returnedState !== state || !code) {
        callbackError = "Invalid state or missing code"
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(
          `<html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>Authentication Failed</h1>
            <p>Invalid response from server</p>
            <p>Return to your terminal to continue.</p>
          </body></html>`,
        )
        return
      }

      callbackCode = code
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(
        `<html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Authentication Successful!</h1>
          <p>You can close this window and return to your terminal.</p>
        </body></html>`,
      )
    }
  })

  return new Promise((resolve, reject) => {
    server.listen(redirectPort, "127.0.0.1", async () => {
      serverReady = true

      // Open browser or signal desktop to open auth window
      if (isDesktop) {
        process.stderr.write(`auth-url:${authURL}\n`)
      } else {
        await openBrowser(authURL)
      }

      // Wait for callback
      const timeout = 5 * 60 * 1000 // 5 minutes
      const startTime = Date.now()

      const checkInterval = setInterval(() => {
        if (callbackCode) {
          clearInterval(checkInterval)
          exchangeCode()
        } else if (callbackError) {
          clearInterval(checkInterval)
          server.close()
          reject(new Error(`Authentication failed: ${callbackError}`))
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          server.close()
          reject(new Error("Authentication timeout"))
        }
      }, 100)
    })

    async function exchangeCode() {
      if (!callbackCode) {
        server.close()
        reject(new Error("No authorization code received"))
        return
      }

      try {
        const baseURL = `https://${config.providerDomain}`
        const tokenURL = `${baseURL}/oauth2/token`

        const body = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code: callbackCode,
          redirect_uri: redirectURI,
          code_verifier: codeVerifier,
        })

        const res = await fetch(tokenURL, {
          method: "POST",
          body: body.toString(),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        })

        if (!res.ok) {
          const errorBody = await res.text().catch(() => "")
          throw new Error(`Token request failed: ${res.status} ${res.statusText}${errorBody ? ` — ${errorBody}` : ""}`)
        }

        const data = (await res.json()) as {
          id_token?: string
          access_token?: string
          refresh_token?: string
          expires_in?: number
        }

        if (!data.id_token) {
          throw new Error("No ID token in response")
        }

        server.close()
        resolve({
          idToken: data.id_token,
          accessToken: data.access_token || "",
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
        })
      } catch (err) {
        server.close()
        reject(err)
      }
    }

    server.on("error", (err) => {
      reject(err)
    })
  })
}

/**
 * Refresh OIDC tokens using a refresh token (no browser needed)
 */
export async function refreshOIDCTokens(config: ANRConfig, refreshToken: string): Promise<OIDCTokens> {
  const baseURL = `https://${config.providerDomain}`
  const tokenURL = `${baseURL}/oauth2/token`

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  })

  const res = await fetch(tokenURL, {
    method: "POST",
    body: body.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as {
    id_token?: string
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  if (!data.id_token) {
    throw new Error("No ID token in refresh response")
  }

  return {
    idToken: data.id_token,
    accessToken: data.access_token || "",
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in,
  }
}
