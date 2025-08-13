/**
 * This oauth flow is based on https://github.com/openai/codex/blob/c991c6ef8559adce5314907b8bfd41ceb7bb3962/codex-rs/login/src/login_with_chatgpt.py
**/
import { generatePKCE } from "@openauthjs/openauth/pkce"
import { Auth } from "./index"

export namespace AuthOpenAI {
  const ISSUER = "https://auth.openai.com"
  const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`
  const PORT = 1455
  const HOST = "127.0.0.1"
  const REDIRECT = `http://localhost:${PORT}/auth/callback`
  const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann" // Public Client ID for the Codex CLI

  type TokenPayload = {
    id_token: string
    access_token: string
    refresh_token: string
    expires_in?: number
  }

  function randomId(bytes = 12) {
    const buf = new Uint8Array(bytes)
    crypto.getRandomValues(buf)
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  export async function prepare() {
    const pkce = await generatePKCE()
    const state = randomId(32)

    let resolveDone: (v: boolean) => void = () => {}
    const done = new Promise<boolean>((resolve) => {
      resolveDone = resolve
    })

    const server = Bun.serve({
      hostname: HOST,
      port: PORT,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/success") {
          return new Response(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signed in</title></head><body style="font-family: system-ui; padding: 24px;"><h2>Signed in to opencode</h2><p>You can close this tab.</p></body></html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname !== "/auth/callback") return new Response("Not found", { status: 404 })

        if (url.searchParams.get("state") !== state) {
          resolveDone(false)
          queueMicrotask(() => server.stop())
          return new Response("State mismatch", { status: 400 })
        }

        const code = url.searchParams.get("code")
        if (!code) {
          resolveDone(false)
          queueMicrotask(() => server.stop())
          return new Response("Missing code", { status: 400 })
        }

        const tokenRes = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT,
            client_id: CLIENT_ID,
            code_verifier: pkce.verifier,
          }),
        })

        if (!tokenRes.ok) {
          resolveDone(false)
          queueMicrotask(() => server.stop())
          return new Response("Token exchange failed", { status: 500 })
        }

        const tokenJson = (await tokenRes.json()) as TokenPayload

        const today = new Date()
          .toISOString()
          .slice(0, 10)
        const name = `opencode (${today}) [${randomId(6)}]`

        const exchangeRes = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
            client_id: CLIENT_ID,
            requested_token: "openai-api-key",
            subject_token: tokenJson.id_token,
            subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
            name,
          }),
        })

        if (!exchangeRes.ok) {
          resolveDone(false)
          queueMicrotask(() => server.stop())
          return new Response("API key exchange failed", { status: 500 })
        }

        const exchangeJson = (await exchangeRes.json()) as { access_token?: string }
        const key = exchangeJson.access_token
        if (!key) {
          resolveDone(false)
          queueMicrotask(() => server.stop())
          return new Response("No API key returned", { status: 500 })
        }

        await Auth.set("openai", { type: "api", key })

        resolveDone(true)
        queueMicrotask(() => server.stop())
        return new Response(null, {
          status: 302,
          headers: { Location: `http://localhost:${PORT}/success` },
        })
      },
    })

    const url = new URL(`${ISSUER}/oauth/authorize`)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", CLIENT_ID)
    url.searchParams.set("redirect_uri", REDIRECT)
    url.searchParams.set("scope", "openid profile email offline_access")
    url.searchParams.set("code_challenge", pkce.challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("id_token_add_organizations", "true")
    url.searchParams.set("codex_cli_simplified_flow", "true")
    url.searchParams.set("state", state)

    return { url: url.toString(), done }
  }
}


