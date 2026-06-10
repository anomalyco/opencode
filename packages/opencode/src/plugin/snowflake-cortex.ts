import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export async function SnowflakeCortexAuthPlugin(_input: PluginInput): Promise<Hooks> {
  const accountPrompt = {
    type: "text" as const,
    key: "account",
    message: "Snowflake Account Identifier",
    placeholder: "myorg-myaccount or xy12345.us-east-1",
  }

  return {
    auth: {
      provider: "snowflake-cortex",
      methods: [
        {
          type: "api",
          label: "PAT (Programmatic Access Token)",
          prompts: [accountPrompt],
        },
        {
          type: "oauth",
          label: "SSO (External Browser)",
          prompts: [accountPrompt],
          async authorize(inputs = {}) {
            const account = (inputs.account ?? "").trim()
            if (!account) throw new Error("Snowflake account identifier is required")
            const { initiateExternalBrowserAuth } = await import("@/provider/snowflake/externalbrowser")
            const { default: open } = await import("open")
            const { ssoUrl, callback: completeFn } = await initiateExternalBrowserAuth(account)
            await open(ssoUrl)
            return {
              url: ssoUrl,
              instructions: "Complete SSO login in your browser. Waiting for redirect...",
              method: "auto" as const,
              async callback() {
                const tokens = await completeFn()
                return {
                  type: "success" as const,
                  key: tokens.session_token,
                  metadata: {
                    _auth_type: "snowflake-session",
                    account: tokens.account,
                    master_token: tokens.master_token,
                    session_expires: String(tokens.session_expires),
                    master_expires: String(tokens.master_expires),
                  },
                }
              },
            }
          },
        },
      ],
    },
  }
}
