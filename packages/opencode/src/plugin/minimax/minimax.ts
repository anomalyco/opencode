import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { setTimeout as sleep } from "node:timers/promises"
import { createHash, randomBytes } from "node:crypto"
import { Auth } from "@/auth"

// Base URL of the user_management service (auth endpoints)
// Override via MINIMAX_AUTH_URL environment variable
const AUTH_BASE_URL = process.env.MINIMAX_AUTH_URL ?? "https://api.minimaxi.com"

// Default AI API resource URL (from Apollo config resource_url)
const DEFAULT_RESOURCE_URL = "https://api.minimaxi.com/anthropic"

// OAuth client ID, matches Apollo config "openCode" client
const CLIENT_ID = "d38bdbee-2b8c-4c74-9a9c-5875fabe6317"

// grant_type for device flow, must match Apollo config
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:user_code"

// Extra buffer before expiry to trigger proactive refresh (ms)
const REFRESH_BUFFER_MS = 5 * 60 * 1000

// Safety margin added to polling interval to avoid clock skew
const POLL_SAFETY_MARGIN_MS = 1_000

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

async function doRefresh(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
  expired_in: number
  resource_url: string
} | null> {
  const response = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  }).catch(() => null)

  if (!response || !response.ok) return null

  const data = (await response.json()) as {
    status: string
    access_token?: string
    refresh_token?: string
    expired_in?: number
    resource_url?: string
  }

  if (data.status !== "success" || !data.access_token) return null

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expired_in: data.expired_in ?? 0,
    resource_url: data.resource_url ?? "",
  }
}

export async function MinimaxAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "minimax",

      async loader(getAuth) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}

        let accessToken = info.access
        // enterpriseUrl field is repurposed to store the AI API resource URL
        const resourceUrl = info.enterpriseUrl ?? DEFAULT_RESOURCE_URL

        // Proactively refresh if token is expired or about to expire
        if (info.expires > 0 && info.expires < Date.now() + REFRESH_BUFFER_MS) {
          const refreshed = await doRefresh(info.refresh).catch(() => null)
          if (refreshed) {
            accessToken = refreshed.access_token
            // Persist refreshed tokens so subsequent calls use the updated values
            await Auth.set("minimax", {
              type: "oauth",
              access: refreshed.access_token,
              refresh: refreshed.refresh_token,
              expires: refreshed.expired_in,
              enterpriseUrl: refreshed.resource_url || resourceUrl,
            })
          }
        }

        return {
          baseURL: resourceUrl,
          apiKey: accessToken,
        }
      },

      methods: [
        {
          type: "oauth",
          label: "Login with MiniMax",

          async authorize() {
            const codeVerifier = generateCodeVerifier()
            const codeChallenge = generateCodeChallenge(codeVerifier)
            const state = randomBytes(16).toString("base64url")

            const response = await fetch(`${AUTH_BASE_URL}/oauth/code`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                response_type: "code",
                client_id: CLIENT_ID,
                state,
                code_challenge: codeChallenge,
                code_challenge_method: "S256",
              }),
            })

            if (!response.ok) {
              throw new Error(`Failed to initiate MiniMax device authorization: ${response.status}`)
            }

            const data = (await response.json()) as {
              verification_uri: string
              user_code: string
              expired_in: number
              interval: number
              state: string
            }

            if (data.state !== state) {
              throw new Error("OAuth state mismatch: possible CSRF attack")
            }

            const pollIntervalMs = data.interval ?? 5000

            return {
              url: data.verification_uri,
              instructions: `Enter code: ${data.user_code}`,
              method: "auto" as const,

              async callback() {
                while (true) {
                  await sleep(pollIntervalMs + POLL_SAFETY_MARGIN_MS)

                  const tokenResponse = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      grant_type: DEVICE_GRANT_TYPE,
                      client_id: CLIENT_ID,
                      user_code: data.user_code,
                      code_verifier: codeVerifier,
                    }),
                  }).catch(() => null)

                  if (!tokenResponse || !tokenResponse.ok) return { type: "failed" as const }

                  const tokenData = (await tokenResponse.json()) as {
                    status: string
                    access_token?: string
                    refresh_token?: string
                    expired_in?: number
                    resource_url?: string
                  }

                  if (tokenData.status === "success" && tokenData.access_token) {
                    return {
                      type: "success" as const,
                      access: tokenData.access_token,
                      refresh: tokenData.refresh_token ?? "",
                      expires: tokenData.expired_in ?? 0,
                      // Reuse enterpriseUrl field to carry the AI API resource URL
                      enterpriseUrl: tokenData.resource_url,
                    }
                  }

                  if (tokenData.status === "pending") continue

                  return { type: "failed" as const }
                }
              },
            }
          },
        },
      ],
    },
  }
}
