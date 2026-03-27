import type { Hooks, PluginInput } from "@opencode-ai/plugin"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const REDIRECT_URL = "https://console.anthropic.com/oauth/code/callback"
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
const CREATE_URL = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key"

function rand(size: number) {
  const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const buf = crypto.getRandomValues(new Uint8Array(size))
  return Array.from(buf)
    .map((x) => text[x % text.length])
    .join("")
}

function b64(buf: ArrayBuffer) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function pkce() {
  const verifier = rand(43)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return {
    verifier,
    challenge: b64(hash),
  }
}

async function authorize() {
  const code = await pkce()
  const url = new URL("https://console.anthropic.com/oauth/authorize")
  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", REDIRECT_URL)
  url.searchParams.set("scope", "org:create_api_key user:profile user:inference")
  url.searchParams.set("code_challenge", code.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", code.verifier)
  return {
    url: url.toString(),
    verifier: code.verifier,
  }
}

async function exchange(code: string, verifier: string) {
  const [value, state] = code.split("#")
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: value,
      state,
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URL,
      code_verifier: verifier,
    }),
  })
  if (!res.ok) return
  return (await res.json()) as {
    access_token: string
  }
}

export async function AnthropicAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      methods: [
        {
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const auth = await authorize()
            return {
              url: auth.url,
              instructions: "Paste the authorization code here:",
              method: "code" as const,
              callback: async (code) => {
                const token = await exchange(code, auth.verifier)
                if (!token) return { type: "failed" as const }

                const res = await fetch(CREATE_URL, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    authorization: `Bearer ${token.access_token}`,
                  },
                })
                if (!res.ok) return { type: "failed" as const }

                const json = (await res.json()) as { raw_key?: string }
                if (!json.raw_key) return { type: "failed" as const }

                return {
                  type: "success" as const,
                  key: json.raw_key,
                }
              },
            }
          },
        },
        {
          label: "API key",
          type: "api",
        },
      ],
    },
  }
}
