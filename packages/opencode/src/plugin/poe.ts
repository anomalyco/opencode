import type { AuthOuathResult, Hooks, PluginInput } from "@opencode-ai/plugin"
import { createOAuthClient } from "poe-oauth"

const CLIENT_ID = "client_728290227fc048cc9262091a1ea197ea"

async function authorize(): Promise<AuthOuathResult> {
  const client = createOAuthClient({
    clientId: CLIENT_ID,
    openBrowser: async (url) => {
      const open = await import("open")
      await open.default(url)
    },
  })

  const authorization = await client.authorize()

  return {
    url: authorization.authorizationUrl,
    instructions: "Complete authorization in your browser. This window will close automatically.",
    method: "auto" as const,
    callback: async () => {
      const result = await authorization.waitForResult()
      return {
        type: "success" as const,
        access: result.apiKey,
        refresh: result.apiKey,
        expires: result.expiresIn == null ? Number.MAX_SAFE_INTEGER : Date.now() + result.expiresIn * 1000,
      }
    },
  }
}

export async function PoeAuthPlugin(input: PluginInput): Promise<Hooks> {
  void input
  return {
    auth: {
      provider: "poe",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type === "api") return { apiKey: auth.key }
        if (auth.type !== "oauth") return {}
        if (auth.expires < Date.now()) throw new Error("Poe API key expired. Run `opencode providers login` again.")
        return { apiKey: auth.access }
      },
      methods: [
        {
          label: "Login with Poe (browser)",
          type: "oauth",
          authorize,
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
