import * as prompts from "@clack/prompts"
import { Auth } from "./index"
import open from "open"

export namespace GoogleAuth {
  const CALLBACK_PORT = 45961
  const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/oauth2callback`

  // NOTE: These would typically come from an environment variable or a configuration file.
  // For the purpose of this implementation, we assume the user might provide them 
  // or they are baked into the CLI if it's an official integration.
  // If OpenCode has its own proxy for this, the URL would point there.
  const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
  const TOKEN_URL = "https://oauth2.googleapis.com/token"

  export async function loginWeb(redirectUrl?: string) {
    const existing = await Auth.get("google")

    // OpenCode requires client ID and secret to be provided via environment variables
    // or configured in the auth provider settings.
    const DEFAULT_CLIENT_ID = ""
    const DEFAULT_CLIENT_SECRET = ""

    let clientId = process.env.GOOGLE_CLIENT_ID || (existing?.type === "oauth" ? existing.clientId : undefined) || DEFAULT_CLIENT_ID
    let clientSecret = process.env.GOOGLE_CLIENT_SECRET || (existing?.type === "oauth" ? existing.clientSecret : undefined) || DEFAULT_CLIENT_SECRET

    const state = Math.random().toString(36).substring(7)
    const scope = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"

    const url = new URL(AUTH_URL)
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("redirect_uri", REDIRECT_URI)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", scope)
    url.searchParams.set("state", state)
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")

    prompts.log.info("Opening browser for Google Authentication...")
    await open(url.toString())

    const spinner = prompts.spinner()
    spinner.start("Waiting for authorization...")

    return new Promise<void>((resolve, reject) => {
      const server = Bun.serve({
        port: CALLBACK_PORT,
        async fetch(req) {
          const reqUrl = new URL(req.url)
          if (reqUrl.pathname === "/oauth2callback") {
            const code = reqUrl.searchParams.get("code")
            const returnedState = reqUrl.searchParams.get("state")

            if (returnedState !== state) {
              spinner.stop("State mismatch error", 1)
              resolve()
              return new Response("Authentication failed: State mismatch", { status: 400 })
            }

            if (!code) {
              spinner.stop("No authorization code received", 1)
              resolve()
              return new Response("Authentication failed: No code", { status: 400 })
            }

            try {
              const tokenResponse = await fetch(TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  code,
                  client_id: clientId!,
                  client_secret: clientSecret!,
                  redirect_uri: REDIRECT_URI,
                  grant_type: "authorization_code",
                }),
              })

              const tokens = await tokenResponse.json() as any

              if (tokens.error) {
                spinner.stop(`Token exchange failed: ${tokens.error_description || tokens.error}`, 1)
              } else {
                await Auth.set("google", {
                  type: "oauth",
                  access: tokens.access_token,
                  refresh: tokens.refresh_token,
                  expires: Date.now() + tokens.expires_in * 1000,
                  clientId,
                  clientSecret,
                })
                spinner.stop("Google Login successful")
              }
            } catch (err) {
              spinner.stop("Error during token exchange", 1)
              console.error(err)
            }

            // Small delay to ensure user sees the "Success" message in browser before server stops
            setTimeout(() => {
              server.stop()
              resolve()
            }, 1000)

            if (redirectUrl) {
              return Response.redirect(redirectUrl)
            }
            return new Response("Authentication successful! You can close this window and return to the CLI.")
          }
          /**
           * By default, Bun server will return 404 for any other path.
           * However, typically oauth redirects might have fragment based redirect 
           * or just hit /callback directly from browser.
           * We need to handle options request or just return 404 for favicon etc.
           */
          return new Response("Not Found", { status: 404 })
        },
      })
    })
  }
}
