import type { AuthOuathResult, Hooks } from "@opencode-ai/plugin"
import { OAuthCallback } from "@/oauth/callback"
import { PKCE, OAuthState } from "@/oauth/pkce"
import type { ProviderAuthAdapter, ProviderAuthMethod } from "../adapter"

const AUTH_URL = process.env["ANTHROPIC_AUTH_URL"] ?? "https://claude.ai/oauth/authorize"
const TOKEN_URL = process.env["ANTHROPIC_TOKEN_URL"] ?? "https://console.anthropic.com/v1/oauth/token"
const CLIENT_ID = process.env["ANTHROPIC_CLIENT_ID"] ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const REDIRECT_URI = process.env["ANTHROPIC_REDIRECT_URI"] ?? "http://localhost:54545/callback"
const SCOPES = process.env["ANTHROPIC_SCOPES"] ?? "org:create_api_key user:profile user:inference"

const REDIRECT = new URL(REDIRECT_URI)
const CALLBACK_PORT = Number(REDIRECT.port || "54545")
const CALLBACK_PATH = REDIRECT.pathname || "/callback"

function buildAuthUrl(state: string, codeChallenge: string): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", REDIRECT_URI)
  url.searchParams.set("scope", SCOPES)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)
  return url.toString()
}

async function exchangeCode(args: { code: string; codeVerifier: string; state: string }) {
  const body = {
    code: args.code.includes("#") ? args.code.split("#")[0] : args.code,
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: args.codeVerifier,
    state: args.state,
  }

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
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
  const body = {
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    refresh_token,
  }

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  })

  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = (json as any)?.error ?? "refresh_failed"
    const desc = (json as any)?.error_description ?? resp.statusText
    throw new Error(`${err}: ${desc}`)
  }

  const access = (json as any)?.access_token
  const refresh = (json as any)?.refresh_token
  const expiresIn = (json as any)?.expires_in
  if (!access) throw new Error("refresh_failed: missing access_token")

  const expires = typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 60 * 1000
  return { access, refresh: refresh ?? refresh_token, expires }
}

export const AnthropicSubscriptionAdapter: ProviderAuthAdapter = {
  providerId: "anthropic",

  authMethods(): ProviderAuthMethod[] {
    const makeOAuth = (mode: "auto" | "code"): ProviderAuthMethod => {
      return {
        type: "oauth",
        label: mode === "auto" ? "Claude Max (OAuth)" : "Claude Max (OAuth - paste code)",
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
    return { ...secret, accessToken: t.access, refreshToken: t.refresh, expiresAt: t.expires }
  },
}
