import type { AuthOuathResult } from "@opencode-ai/plugin"
import { OAuthCallback } from "@/oauth/callback"
import { PKCE, OAuthState } from "@/oauth/pkce"
import type { ProviderAuthAdapter, ProviderAuthMethod } from "../adapter"

const CLIENT_ID =
  process.env["GEMINI_CLIENT_ID"] ??
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const CLIENT_SECRET = process.env["GEMINI_CLIENT_SECRET"]
const AUTHORIZE_URL = process.env["GEMINI_AUTHORIZE_URL"] ?? "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = process.env["GEMINI_TOKEN_URL"] ?? "https://oauth2.googleapis.com/token"
const REDIRECT_URI = process.env["GEMINI_REDIRECT_URI"] ?? "http://localhost:8085/oauth2callback"
const SCOPES =
  process.env["GEMINI_SCOPES"] ??
  "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"

const REDIRECT = new URL(REDIRECT_URI)
const CALLBACK_PORT = Number(REDIRECT.port || "8085")
const CALLBACK_PATH = REDIRECT.pathname || "/oauth2callback"

function buildAuthUrl(state: string, codeChallenge: string): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("redirect_uri", REDIRECT_URI)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", SCOPES)
  url.searchParams.set("state", state)
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

async function exchangeCode(args: { code: string; codeVerifier: string; state: string }) {
  const data = new URLSearchParams()
  data.set("client_id", CLIENT_ID)
  data.set("code", args.code)
  data.set("grant_type", "authorization_code")
  data.set("redirect_uri", REDIRECT_URI)
  data.set("state", args.state)
  data.set("code_verifier", args.codeVerifier)
  if (CLIENT_SECRET) data.set("client_secret", CLIENT_SECRET)

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: data.toString(),
  })

  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = (json as any)?.error ?? "token_exchange_failed"
    const desc = (json as any)?.error_description ?? resp.statusText
    throw new Error(`${err}: ${desc}`)
  }

  const access = (json as any)?.access_token
  const refresh = (json as any)?.refresh_token
  const expiresIn = (json as any)?.expires_in
  if (!access) throw new Error("token_exchange_failed: missing access_token")
  const expires = typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 60 * 1000
  return { access, refresh: refresh ?? "", expires }
}

async function refreshAccessToken(refresh_token: string) {
  const data = new URLSearchParams()
  data.set("client_id", CLIENT_ID)
  data.set("grant_type", "refresh_token")
  data.set("refresh_token", refresh_token)
  if (CLIENT_SECRET) data.set("client_secret", CLIENT_SECRET)

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: data.toString(),
  })

  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = (json as any)?.error ?? "refresh_failed"
    const desc = (json as any)?.error_description ?? resp.statusText
    throw new Error(`${err}: ${desc}`)
  }

  const access = (json as any)?.access_token
  const expiresIn = (json as any)?.expires_in
  if (!access) throw new Error("refresh_failed: missing access_token")
  const expires = typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 60 * 1000
  return { access, expires }
}

export const GoogleGeminiSubscriptionAdapter: ProviderAuthAdapter = {
  providerId: "google",

  authMethods(): ProviderAuthMethod[] {
    const makeOAuth = (mode: "auto" | "code"): ProviderAuthMethod => {
      return {
        type: "oauth",
        label: mode === "auto" ? "Google (Gemini Code Assist OAuth)" : "Google (OAuth - paste code)",
        async authorize(): Promise<AuthOuathResult> {
          const codeVerifier = PKCE.generateVerifier()
          const codeChallenge = PKCE.challengeFromVerifier(codeVerifier)
          const state = OAuthState.generate()
          const url = buildAuthUrl(state, codeChallenge)

          if (mode === "auto") {
            await OAuthCallback.ensureRunning({ port: CALLBACK_PORT, pathname: CALLBACK_PATH })
          }

          return {
            url,
            instructions: "Complete login in your browser. Return here when finished.",
            method: mode,
            async callback(code?: string) {
              try {
                const resolvedCode =
                  mode === "code"
                    ? (code ?? "")
                    : await OAuthCallback.waitForCallback({
                        port: CALLBACK_PORT,
                        pathname: CALLBACK_PATH,
                        key: state,
                      })
                if (!resolvedCode) return { type: "failed" }
                const tokens = await exchangeCode({ code: resolvedCode, codeVerifier, state })
                return { type: "success", access: tokens.access, refresh: tokens.refresh, expires: tokens.expires }
              } catch {
                return { type: "failed" }
              }
            },
          } as AuthOuathResult
        },
      }
    }

    return [makeOAuth("auto"), makeOAuth("code")]
  },

  applyAuth(headers: Headers, secret: any) {
    if (secret && typeof secret === "object" && "accessToken" in secret) {
      headers.set("Authorization", `Bearer ${String((secret as any).accessToken)}`)
    }
  },

  async refresh(secret: any) {
    const refresh = secret?.refreshToken
    if (!refresh) return secret
    const t = await refreshAccessToken(String(refresh))
    return { ...secret, accessToken: t.access, expiresAt: t.expires }
  },
}
