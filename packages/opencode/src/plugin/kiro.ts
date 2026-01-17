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

function getKiroDbPath(): string {
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

async function isTokenValid(token: KiroToken): Promise<boolean> {
  try {
    const expiresAt = new Date(token.expires_at).getTime()
    // Add 5 minute buffer
    return expiresAt > Date.now() + 5 * 60 * 1000
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

        const region = token.region || "us-east-1"
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
            // Re-fetch token to get latest access token
            const currentToken = await getKiroToken()
            if (!currentToken) {
              throw new Error("Kiro CLI token not found. Please run 'kiro login' first.")
            }

            if (!(await isTokenValid(currentToken))) {
              throw new Error("Kiro CLI token expired. Please run 'kiro login' to refresh.")
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
            const token = await getKiroToken()
            if (!token) {
              return {
                url: "https://kiro.dev/docs/cli/installation/",
                instructions:
                  "Kiro CLI is not installed or not logged in. Please install Kiro CLI and run 'kiro login' first, then press Enter to retry.",
                method: "auto" as const,
                async callback() {
                  // Re-check token after user completes installation
                  const newToken = await getKiroToken()
                  if (!newToken || !(await isTokenValid(newToken))) {
                    return { type: "failed" as const }
                  }
                  const expiresAt = new Date(newToken.expires_at).getTime()
                  return {
                    type: "success" as const,
                    refresh: newToken.refresh_token,
                    access: newToken.access_token,
                    expires: expiresAt,
                  }
                },
              }
            }

            if (!(await isTokenValid(token))) {
              return {
                url: "",
                instructions:
                  "Kiro CLI token has expired. Please run 'kiro login' to refresh your credentials, then press Enter to retry.",
                method: "auto" as const,
                async callback() {
                  const newToken = await getKiroToken()
                  if (!newToken || !(await isTokenValid(newToken))) {
                    return { type: "failed" as const }
                  }
                  const expiresAt = new Date(newToken.expires_at).getTime()
                  return {
                    type: "success" as const,
                    refresh: newToken.refresh_token,
                    access: newToken.access_token,
                    expires: expiresAt,
                  }
                },
              }
            }

            // Token exists and is valid
            const expiresAt = new Date(token.expires_at).getTime()
            return {
              url: "",
              instructions: "Using existing Kiro CLI credentials",
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
