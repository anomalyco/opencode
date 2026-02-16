import type { Plugin } from "@opencode-ai/plugin"
import type { AuthInfo } from "./types.js"
import { authenticateWithDeviceAuthTUI } from "./auth/device-auth-tui.js"

export const KiloAuthPlugin: Plugin = async (ctx) => {
  return {
    auth: {
      provider: "kilo",
      async loader(getAuth, providerInfo) {
        const auth = (await getAuth()) as AuthInfo | undefined
        if (!auth) return {}

        if (auth.type === "api") {
          return {
            kilocodeToken: auth.key,
          }
        }

        if (auth.type === "oauth") {
          if (!auth.access) return {}
          const result: Record<string, string> = {
            kilocodeToken: auth.access,
          }
          if (auth.accountId) result.kilocodeOrganizationId = auth.accountId
          return result
        }

        return {}
      },
      methods: [
        {
          type: "oauth",
          label: "Login with Kilo Gateway",
          async authorize() {
            return await authenticateWithDeviceAuthTUI()
          },
        },
      ],
    },
  }
}

export default KiloAuthPlugin
