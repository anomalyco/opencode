import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { OAUTH_DUMMY_KEY } from "../auth"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Option, Schema } from "effect"

const AZURE_SCOPE = "https://cognitiveservices.azure.com"
const AZURE_TOKEN_REFRESH_BUFFER = 60_000
const AzureCliToken = Schema.Struct({
  accessToken: Schema.String,
  expires_on: Schema.optional(Schema.Number),
  expiresOn: Schema.optional(Schema.String),
})
const decodeAzureCliToken = Schema.decodeUnknownOption(Schema.fromJsonString(AzureCliToken))

export async function AzureAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return azureAuthPlugin({
    provider: "azure",
    resourceEnv: "AZURE_RESOURCE_NAME",
    oauthInstructions:
      "Sign in with `az login`. The signed-in Azure identity must have the Cognitive Services OpenAI User role for this resource.",
    prompts: process.env.AZURE_RESOURCE_NAME
      ? []
      : [
          {
            type: "text" as const,
            key: "resourceName",
            message: "Enter Azure Resource Name",
            placeholder: "e.g. my-models",
          },
        ],
    providerOptions: (resourceName) => ({ resourceName }),
  })
}

export async function AzureCognitiveServicesAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return azureAuthPlugin({
    provider: "azure-cognitive-services",
    resourceEnv: "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
    oauthInstructions:
      "Sign in with `az login`. The signed-in Azure identity must have the Cognitive Services User or Foundry User role for this resource.",
    prompts: process.env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
      ? []
      : [
          {
            type: "text" as const,
            key: "resourceName",
            message: "Enter Azure Cognitive Services Resource Name",
            placeholder: "e.g. my-models",
          },
        ],
  })
}

function azureAuthPlugin(input: {
  provider: string
  resourceEnv: string
  oauthInstructions: string
  prompts: NonNullable<Hooks["auth"]>["methods"][number]["prompts"]
  providerOptions?: (resourceName: string) => Record<string, string>
}): Hooks {
  const tokenProvider = azureCliTokenProvider()
  return {
    auth: {
      provider: input.provider,
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const resourceName = process.env[input.resourceEnv] || auth.accountId
        return {
          ...((resourceName && input.providerOptions?.(resourceName)) ?? {}),
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
            if (init?.headers) {
              const entries =
                init.headers instanceof Headers
                  ? init.headers.entries()
                  : Array.isArray(init.headers)
                    ? init.headers
                    : Object.entries(init.headers as Record<string, string | undefined>)
              for (const [key, value] of entries) {
                if (value !== undefined) headers.set(key, String(value))
              }
            }
            headers.delete("api-key")
            headers.delete("x-api-key")
            headers.set("authorization", `Bearer ${await tokenProvider()}`)
            headers.set("User-Agent", `opencode/${InstallationVersion}`)

            return fetch(requestInput, { ...init, headers })
          },
        }
      },
      methods: [
        {
          type: "api",
          label: "API key",
          prompts: input.prompts,
        },
        {
          type: "oauth",
          label: "Microsoft Entra ID (OAuth via az cli)",
          prompts: input.prompts,
          authorize: async (inputs) => ({
            url: "https://learn.microsoft.com/azure/developer/ai/keyless-connections",
            instructions: input.oauthInstructions,
            method: "auto" as const,
            callback: async () => {
              await tokenProvider()
              return {
                type: "success" as const,
                access: OAUTH_DUMMY_KEY,
                refresh: OAUTH_DUMMY_KEY,
                expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
                accountId: inputs?.resourceName || process.env[input.resourceEnv],
              }
            },
          }),
        },
      ],
    },
  }
}

function azureCliTokenProvider() {
  let cached: { token: string; expires: number } | undefined
  return async () => {
    if (cached && cached.expires - Date.now() > AZURE_TOKEN_REFRESH_BUFFER) return cached.token

    const proc = spawnAzureCliTokenCommand()
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "Failed to get Azure access token. Run `az login` and try again.")
    }

    const decoded = decodeAzureCliToken(stdout)
    if (Option.isNone(decoded)) throw new Error("Azure CLI did not return an access token")

    cached = {
      token: decoded.value.accessToken,
      // Azure CLI's expiresOn is a timezone-less local datetime; expires_on avoids DST ambiguity.
      expires:
        decoded.value.expires_on !== undefined
          ? decoded.value.expires_on * 1000
          : decoded.value.expiresOn
            ? new Date(decoded.value.expiresOn).getTime()
            : Date.now() + 30 * 60 * 1000,
    }
    return cached.token
  }
}

function spawnAzureCliTokenCommand() {
  try {
    return Bun.spawn(["az", "account", "get-access-token", "--resource", AZURE_SCOPE, "--output", "json"], {
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (error) {
    throw new Error("Azure CLI is required for Microsoft Entra ID OAuth. Install `az`, run `az login`, and try again.", {
      cause: error,
    })
  }
}
