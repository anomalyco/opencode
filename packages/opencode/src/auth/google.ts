import { OAuth2Client } from "google-auth-library"
import { Auth } from "./index.js"
import * as http from "http"
import * as url from "url"
import crypto from "crypto"

export namespace AuthGoogle {
  const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
  const CLIENT_SECRET = "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"
  const SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]

  let oauthClient: OAuth2Client | null = null

  export async function getOAuthClient(): Promise<OAuth2Client> {
    if (!oauthClient) {
      oauthClient = new OAuth2Client({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      })
    }

    // Check if we have cached credentials
    const savedAuth = await Auth.get("google")
    if (savedAuth && savedAuth.type === "oauth") {
      oauthClient.setCredentials({
        access_token: savedAuth.access,
        refresh_token: savedAuth.refresh,
        expiry_date: savedAuth.expires,
      })
      
      // Verify the credentials are still valid
      try {
        const { token } = await oauthClient.getAccessToken()
        if (token) {
          return oauthClient
        }
      } catch {
        // Token invalid, will proceed with new auth
      }
    }

    return oauthClient
  }

  export async function authorize() {
    const client = await getOAuthClient()
    const port = await findAvailablePort()
    const redirectUri = `http://localhost:${port}/oauth2callback`
    const state = crypto.randomBytes(32).toString('hex')
    
    const authUrl = client.generateAuthUrl({
      redirect_uri: redirectUri,
      access_type: 'offline',
      scope: SCOPES,
      state,
      prompt: 'consent', // Force consent to ensure refresh token
    })

    return {
      url: authUrl,
      state,
      port,
      redirectUri,
      client
    }
  }

  async function findAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("Port check")
        },
      })
      const port = server.port
      server.stop()
      resolve(port!)
    })
  }

  export async function waitForCallback(
    state: string, 
    port: number, 
    redirectUri: string,
    client: OAuth2Client
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          if (!req.url?.includes('/oauth2callback')) {
            res.writeHead(404)
            res.end()
            return
          }

          const qs = new url.URL(req.url!, `http://localhost:${port}`).searchParams
          
          if (qs.get('error')) {
            res.writeHead(302, { Location: 'https://opencode.ai/docs' })
            res.end()
            reject(new Error(`OAuth error: ${qs.get('error')}`))
            return
          }
          
          if (qs.get('state') !== state) {
            res.writeHead(400)
            res.end('State mismatch')
            reject(new Error('State mismatch - possible CSRF attack'))
            return
          }
          
          const code = qs.get('code')
          if (!code) {
            res.writeHead(400)
            res.end('No code found')
            reject(new Error('No authorization code received'))
            return
          }

          const { tokens } = await client.getToken({
            code,
            redirect_uri: redirectUri,
          })
          
          client.setCredentials(tokens)
          
          // Save to our auth system
          await Auth.set("google", {
            type: "oauth",
            refresh: tokens.refresh_token!,
            access: tokens.access_token!,
            expires: tokens.expiry_date!,
          })

          res.writeHead(302, { Location: 'https://opencode.ai/docs' })
          res.end()
          

          setTimeout(() => {
            server.close(() => {
              resolve()
            })
          }, 100)
        } catch (error) {
          server.close(() => {
            reject(error)
          })
        }
      })
      
      server.listen(port)

      const timeout = setTimeout(() => {
        server.close(() => {
          reject(new Error("OAuth callback timeout"))
        })
      }, 5 * 60 * 1000)
      
      server.on('close', () => {
        clearTimeout(timeout)
      })
    })
  }

  export async function access(): Promise<string | undefined> {
    const client = await getOAuthClient()
    
    try {
      const { token } = await client.getAccessToken()
      return token || undefined
    } catch {
      return undefined
    }
  }
}