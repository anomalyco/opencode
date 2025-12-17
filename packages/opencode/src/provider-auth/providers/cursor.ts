import type { AuthOuathResult } from "@opencode-ai/plugin"
import crypto from "crypto"
import type { ProviderAuthAdapter, ProviderAuthMethod } from "../adapter"

const AUTHENTICATOR_URL = process.env["CURSOR_AUTHENTICATOR_URL"] ?? "https://authenticator.cursor.sh"
const API_URL = process.env["CURSOR_API_URL"] ?? "https://api2.cursor.sh"
const LOGIN_URL = process.env["CURSOR_LOGIN_URL"] ?? `${AUTHENTICATOR_URL}/login`
const POLL_URL = process.env["CURSOR_POLL_URL"] ?? `${API_URL}/auth/poll`
const REFRESH_URL = process.env["CURSOR_REFRESH_URL"] ?? `${API_URL}/auth/refresh`

type CursorTokenPayload = {
  accessToken?: string
  refreshToken?: string
  access_token?: string
  refresh_token?: string
  expiresIn?: number
  expires_in?: number
}

function startSession() {
  const uuid = crypto.randomUUID()
  const verifier = crypto.randomBytes(32).toString("hex")
  const url = new URL(LOGIN_URL)
  url.searchParams.set("uuid", uuid)
  url.searchParams.set("verifier", verifier)
  return { uuid, verifier, loginUrl: url.toString() }
}

async function pollForToken(session: { uuid: string; verifier: string }, maxWaitMs: number = 15 * 60 * 1000) {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const url = new URL(POLL_URL)
    url.searchParams.set("uuid", session.uuid)
    url.searchParams.set("verifier", session.verifier)
    const resp = await fetch(url.toString(), { headers: { Accept: "application/json" } })
    if (resp.status === 200) {
      const json = (await resp.json().catch(() => ({}))) as CursorTokenPayload
      const access = json.accessToken ?? json.access_token
      const refresh = json.refreshToken ?? json.refresh_token
      if (!access) throw new Error("poll_failed: missing access token")
      const expiresIn = json.expiresIn ?? json.expires_in
      const expires = typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 60 * 1000
      return { access, refresh: refresh ?? "", expires }
    }
    if (resp.status === 401 || resp.status === 404 || resp.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }
    throw new Error(`poll_failed: HTTP ${resp.status}`)
  }
  throw new Error("timeout: polling timed out")
}

async function refreshToken(refresh_token: string) {
  const resp = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ refresh_token }),
  })
  if (!resp.ok) throw new Error(`refresh_failed: HTTP ${resp.status}`)
  const json = (await resp.json().catch(() => ({}))) as CursorTokenPayload
  const access = json.accessToken ?? json.access_token
  const refresh = json.refreshToken ?? json.refresh_token
  if (!access) throw new Error("refresh_failed: missing access token")
  const expiresIn = json.expiresIn ?? json.expires_in
  const expires = typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 60 * 1000
  return { access, refresh: refresh ?? refresh_token, expires }
}

export const CursorSubscriptionAdapter: ProviderAuthAdapter = {
  providerId: "cursor",

  authMethods(): ProviderAuthMethod[] {
    return [
      {
        type: "oauth",
        label: "Cursor (Device Link Login)",
        async authorize(): Promise<AuthOuathResult> {
          const session = startSession()
          return {
            url: session.loginUrl,
            instructions: "Complete login in your browser. Return here when finished.",
            method: "auto",
            async callback() {
              try {
                const token = await pollForToken(session)
                return { type: "success", access: token.access, refresh: token.refresh, expires: token.expires }
              } catch {
                return { type: "failed" }
              }
            },
          } as AuthOuathResult
        },
      },
    ]
  },

  applyAuth(headers: Headers, secret: any) {
    if (secret && typeof secret === "object" && "accessToken" in secret) {
      headers.set("Authorization", `Bearer ${String((secret as any).accessToken)}`)
    }
  },

  async refresh(secret: any) {
    const refresh = secret?.refreshToken
    if (!refresh) return secret
    const t = await refreshToken(String(refresh))
    return { ...secret, accessToken: t.access, refreshToken: t.refresh, expiresAt: t.expires }
  },
}

