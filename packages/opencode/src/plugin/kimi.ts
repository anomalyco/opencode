import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Installation } from "@/installation"

const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098"
const OAUTH_HOST = "https://auth.kimi.com"
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000

export async function KimiAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "kimi-for-coding",
      async loader(getAuth, provider) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}

        if (provider?.models) {
          for (const model of Object.values(provider.models)) {
            model.cost = { input: 0, output: 0, cache: { read: 0, write: 0 } }
          }
        }

        return {
          apiKey: info.access,
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            const auth = await getAuth()
            if (auth.type !== "oauth") return fetch(request, init)

            if (!auth.access || auth.expires < Date.now()) {
              const res = await fetch(`${OAUTH_HOST}/api/oauth/token`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Msh-Platform": "opencode",
                },
                body: JSON.stringify({
                  client_id: CLIENT_ID,
                  refresh_token: auth.refresh,
                  grant_type: "refresh_token",
                }),
              })

              if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)

              const tokens = (await res.json()) as {
                access_token: string
                refresh_token: string
                expires_in?: number
              }

              await input.client.auth.set({
                path: { id: "kimi-for-coding" },
                body: {
                  type: "oauth",
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                },
              })

              auth.access = tokens.access_token
            }

            const headers = new Headers(init?.headers as HeadersInit)
            headers.set("Authorization", `Bearer ${auth.access}`)
            return fetch(request, { ...init, headers })
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Login with Kimi Code",
          async authorize() {
            const deviceResponse = await fetch(`${OAUTH_HOST}/api/oauth/device_authorization`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Msh-Platform": "opencode",
                "User-Agent": `opencode/${Installation.VERSION}`,
              },
              body: JSON.stringify({ client_id: CLIENT_ID }),
            })

            if (!deviceResponse.ok) throw new Error("Failed to initiate device authorization")

            const deviceData = (await deviceResponse.json()) as {
              verification_uri: string
              verification_uri_complete: string
              user_code: string
              device_code: string
              interval: number
              expires_in: number
            }

            return {
              url: deviceData.verification_uri_complete || deviceData.verification_uri,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                const interval = (deviceData.interval || 5) * 1000

                while (true) {
                  const response = await fetch(`${OAUTH_HOST}/api/oauth/token`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Msh-Platform": "opencode",
                      "User-Agent": `opencode/${Installation.VERSION}`,
                    },
                    body: JSON.stringify({
                      client_id: CLIENT_ID,
                      device_code: deviceData.device_code,
                      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    }),
                  })

                  if (response.ok) {
                    const data = (await response.json()) as {
                      access_token: string
                      refresh_token: string
                      expires_in?: number
                    }
                    return {
                      type: "success" as const,
                      refresh: data.refresh_token,
                      access: data.access_token,
                      expires: Date.now() + (data.expires_in ?? 3600) * 1000,
                    }
                  }

                  const error = (await response.json().catch(() => ({ error: "unknown" }))) as {
                    error?: string
                    interval?: number
                  }

                  if (error.error === "authorization_pending") {
                    await Bun.sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                    continue
                  }

                  if (error.error === "slow_down") {
                    await Bun.sleep(
                      (error.interval ?? deviceData.interval + 5) * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS,
                    )
                    continue
                  }

                  if (error.error) return { type: "failed" as const }

                  await Bun.sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
