import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "plugin.bedrock" })

export const BEDROCK_CREDENTIAL_CHAIN_MARKER = "__aws_credential_chain__"

export async function BedrockAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "amazon-bedrock",
      methods: [
        {
          type: "oauth",
          label: "Use AWS credentials",
          async authorize() {
            const { fromNodeProviderChain } = await import("@aws-sdk/credential-providers")
            const profile = process.env.AWS_PROFILE
            const provider = fromNodeProviderChain(profile ? { profile } : {})

            try {
              const creds = await provider()
              log.info("aws credential chain resolved", {
                accessKeyId: creds.accessKeyId ? `${creds.accessKeyId.slice(0, 4)}...` : undefined,
                hasSessionToken: !!creds.sessionToken,
              })
            } catch (e: any) {
              const message = e instanceof Error ? e.message : String(e)
              log.error("aws credential chain failed", { error: message })
              return {
                url: "",
                instructions: [
                  `AWS credential resolution failed: ${message}`,
                  "",
                  "Ensure one of the following is configured:",
                  "  - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars",
                  "  - AWS_PROFILE env var pointing to a named profile",
                  "  - EC2 instance profile (IMDS reachable)",
                  "  - ECS container credentials",
                  "  - ~/.aws/credentials with a [default] profile",
                ].join("\n"),
                method: "code" as const,
                async callback(_code: string) {
                  return { type: "failed" as const }
                },
              }
            }

            return {
              url: "",
              instructions: "AWS credentials verified successfully.",
              method: "auto" as const,
              async callback() {
                return {
                  type: "success" as const,
                  provider: "amazon-bedrock",
                  key: "",
                  metadata: { source: "credential-chain" },
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "Enter bearer token",
        },
      ],
    },
  }
}
