import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as path from "path"
import * as os from "os"

interface KiroToken {
  access_token: string
  expires_at: string
  refresh_token: string
  region: string
  start_url: string
  oauth_flow: string
  scopes: string[]
}

interface KiroDeviceRegistration {
  client_id: string
  client_secret: string
  client_secret_expires_at: string
  region: string
  oauth_flow: string
  scopes: string[]
}

interface RefreshTokenResponse {
  accessToken: string
  expiresIn: number
  refreshToken?: string
}

export function getKiroDbPath(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library/Application Support/kiro-cli/data.sqlite3")
    case "win32":
      return path.join(process.env.APPDATA || "", "kiro-cli/data.sqlite3")
    default:
      return path.join(os.homedir(), ".local/share/kiro-cli/data.sqlite3")
  }
}

async function getKiroToken(): Promise<KiroToken | null> {
  const dbPath = getKiroDbPath()
  const file = Bun.file(dbPath)
  if (!(await file.exists())) return null

  try {
    const { Database } = await import("bun:sqlite")
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query<{ value: string }, [string]>("SELECT value FROM auth_kv WHERE key = ?")
      .get("kirocli:odic:token")
    db.close()

    if (!row) return null
    return JSON.parse(row.value) as KiroToken
  } catch {
    return null
  }
}

async function getKiroDeviceRegistration(): Promise<KiroDeviceRegistration | null> {
  const dbPath = getKiroDbPath()
  const file = Bun.file(dbPath)
  if (!(await file.exists())) return null

  try {
    const { Database } = await import("bun:sqlite")
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query<{ value: string }, [string]>("SELECT value FROM auth_kv WHERE key = ?")
      .get("kirocli:odic:device-registration")
    db.close()

    if (!row) return null
    return JSON.parse(row.value) as KiroDeviceRegistration
  } catch {
    return null
  }
}

async function saveKiroToken(token: KiroToken): Promise<boolean> {
  const dbPath = getKiroDbPath()

  try {
    const { Database } = await import("bun:sqlite")
    const db = new Database(dbPath)
    db.query("UPDATE auth_kv SET value = ? WHERE key = ?").run(JSON.stringify(token), "kirocli:odic:token")
    db.close()
    return true
  } catch {
    return false
  }
}

async function isTokenValid(token: KiroToken): Promise<boolean> {
  try {
    const expiresAt = new Date(token.expires_at).getTime()
    // Add 5 minute buffer
    return expiresAt > Date.now() + 5 * 60 * 1000
  } catch {
    return false
  }
}

async function refreshKiroToken(token: KiroToken, registration: KiroDeviceRegistration): Promise<KiroToken | null> {
  const region = token.region || "us-east-1"
  const ssoOidcEndpoint = `https://oidc.${region}.amazonaws.com/token`

  try {
    const response = await fetch(ssoOidcEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grantType: "refresh_token",
        clientId: registration.client_id,
        clientSecret: registration.client_secret,
        refreshToken: token.refresh_token,
      }),
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as RefreshTokenResponse

    // Create updated token
    const newToken: KiroToken = {
      ...token,
      access_token: data.accessToken,
      expires_at: new Date(Date.now() + data.expiresIn * 1000).toISOString(),
      refresh_token: data.refreshToken || token.refresh_token,
    }

    // Save to database
    await saveKiroToken(newToken)

    return newToken
  } catch {
    return null
  }
}

async function getValidToken(): Promise<KiroToken | null> {
  let token = await getKiroToken()
  if (!token) return null

  // If token is still valid, return it
  if (await isTokenValid(token)) {
    return token
  }

  // Try to refresh the token
  const registration = await getKiroDeviceRegistration()
  if (!registration) {
    return null
  }

  // Attempt refresh
  const refreshedToken = await refreshKiroToken(token, registration)
  if (refreshedToken) {
    return refreshedToken
  }

  return null
}

async function runKiroLogin(): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ["kiro-cli", "login"],
      stdio: ["inherit", "inherit", "inherit"],
    })
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

export async function KiroAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "kiro",
      async loader(getAuth, provider) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}

        // Get token to determine region for baseURL
        const token = await getKiroToken()
        if (!token) return {}

        // Kiro API endpoint is currently only available in us-east-1
        const region = "us-east-1"
        const baseURL = `https://codewhisperer.${region}.amazonaws.com`

        // Set cost to 0 for subscription models
        if (provider?.models) {
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            }
          }
        }

        return {
          baseURL,
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            // Get valid token (auto-refresh if needed)
            const currentToken = await getValidToken()
            if (!currentToken) {
              throw new Error("Kiro CLI token not found or refresh failed. Please run 'kiro-cli login'.")
            }

            const headers = new Headers(init?.headers)
            headers.set("Authorization", `Bearer ${currentToken.access_token}`)
            headers.set("x-amzn-codewhisperer-optout", "false")

            // Remove any existing API key headers
            headers.delete("x-api-key")

            return fetch(request, {
              ...init,
              headers,
            })
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Use existing Kiro CLI login",
          async authorize() {
            // Try to get a valid token (with auto-refresh)
            let token = await getValidToken()

            // If no valid token, run kiro-cli login
            if (!token) {
              const loginSuccess = await runKiroLogin()
              if (!loginSuccess) {
                return {
                  url: "https://kiro.dev/docs/cli/installation/",
                  instructions: "Kiro CLI login failed. Please ensure Kiro CLI is installed and try again.",
                  method: "auto" as const,
                  async callback() {
                    return { type: "failed" as const }
                  },
                }
              }
              // Re-fetch token after login
              token = await getKiroToken()
              if (!token || !(await isTokenValid(token))) {
                return {
                  url: "",
                  instructions: "Failed to get valid token after login.",
                  method: "auto" as const,
                  async callback() {
                    return { type: "failed" as const }
                  },
                }
              }
            }

            // Token exists and is valid
            const expiresAt = new Date(token.expires_at).getTime()
            return {
              url: "",
              instructions: "Using Kiro CLI credentials",
              method: "auto" as const,
              async callback() {
                return {
                  type: "success" as const,
                  refresh: token.refresh_token,
                  access: token.access_token,
                  expires: expiresAt,
                }
              },
            }
          },
        },
      ],
    },
  }
}
