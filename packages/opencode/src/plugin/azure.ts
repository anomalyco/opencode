import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { which } from "@opencode-ai/core/util/which"
import type { Hooks } from "@opencode-ai/plugin"
import type { Provider } from "@opencode-ai/sdk/v2"
import { Effect, Schema } from "effect"
import { OAUTH_DUMMY_KEY } from "../auth"
import { Process } from "../util/process"

const AZURE_COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"
const AZURE_FOUNDRY_SCOPE = "https://ai.azure.com/.default"
const AZURE_TOKEN_REFRESH_BUFFER = 60_000

const AzureCliToken = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  expires_on: Schema.optional(Schema.Number),
  expiresOn: Schema.optional(Schema.NonEmptyString),
})
const decodeAzureCliToken = Schema.decodeUnknownPromise(AzureCliToken)
const decodeAzureProfile = Schema.decodeUnknownPromise(
  Schema.fromJsonString(Schema.Struct({ subscriptions: Schema.Array(Schema.Unknown) })),
)

const decodeAzureAccounts = Schema.decodeUnknownPromise(
  Schema.Array(
    Schema.Struct({
      name: Schema.NonEmptyString,
      resourceGroup: Schema.NonEmptyString,
    }),
  ),
)

const decodeAzureDeployments = Schema.decodeUnknownPromise(
  Schema.Array(
    Schema.Struct({
      name: Schema.NonEmptyString,
      properties: Schema.Struct({
        model: Schema.Struct({
          name: Schema.NonEmptyString,
        }),
        provisioningState: Schema.NonEmptyString,
      }),
    }),
  ),
)

type AzureCommand = (args: string[]) => Promise<unknown>
type AzureAccount = { readonly name: string; readonly resourceGroup: string }

export async function AzureAuthPlugin(): Promise<Hooks> {
  const available = Boolean(which("az"))
  // Avoid launching Azure CLI on unrelated commands just because the executable is installed.
  const signedIn = available
    ? await readFile(join(process.env.AZURE_CONFIG_DIR ?? join(homedir(), ".azure"), "azureProfile.json"), "utf8")
        .then((text) => decodeAzureProfile(text.replace(/^\uFEFF/, "")))
        .then((profile) => profile.subscriptions.length > 0)
        .catch(() => false)
    : false
  const accounts =
    !process.env.AZURE_RESOURCE_NAME && !process.env.AZURE_RESOURCE_GROUP && signedIn
      ? await runAzure(["cognitiveservices", "account", "list", "--output", "json", "--only-show-errors"])
          .then(decodeAzureAccounts)
          .catch(() => [])
      : []
  return createAzureAuthHooks(runAzure, fetch, accounts, available)
}

export function createAzureAuthHooks(
  run: AzureCommand,
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
  accounts: readonly AzureAccount[] = [],
  available = true,
): Hooks {
  const tokens = new Map<string, { token: string; expires: number }>()
  async function token(scope: string) {
    const cached = tokens.get(scope)
    if (cached && cached.expires - Date.now() > AZURE_TOKEN_REFRESH_BUFFER) return cached.token

    const result = await decodeAzureCliToken(
      await run(["account", "get-access-token", "--scope", scope, "--output", "json"]),
    )
    const expires = result.expires_on !== undefined ? result.expires_on * 1000 : Date.parse(result.expiresOn ?? "")
    if (!Number.isFinite(expires)) throw new Error("Azure CLI returned an invalid token expiration")
    const refreshed = { token: result.accessToken, expires }
    tokens.set(scope, refreshed)
    return refreshed.token
  }

  const prompts = []
  if (!process.env.AZURE_RESOURCE_NAME) {
    prompts.push({
      type: "text" as const,
      key: "resourceName",
      message: "Enter Azure Resource Name",
      placeholder: "e.g. my-models",
    })
  }
  const oauthPrompts =
    accounts.length > 0 && !process.env.AZURE_RESOURCE_NAME
      ? [
          {
            type: "select" as const,
            key: "resourceSelection",
            message: "Select Azure resource",
            options: [
              ...accounts.map((account) => ({
                label: account.name,
                value: account.name,
                hint: account.resourceGroup,
              })),
              { label: "Enter another resource name", value: "__manual__" },
            ],
          },
          {
            type: "text" as const,
            key: "resourceName",
            message: "Enter Azure Resource Name",
            placeholder: "e.g. my-models",
            when: { key: "resourceSelection", op: "eq" as const, value: "__manual__" },
          },
        ]
      : prompts

  const hooks: Hooks = {
    provider: {
      id: "azure",
      async models(provider, context) {
        if (context.auth?.type !== "oauth") return provider.models
        const resource = context.auth.accountId
        if (!resource) return {}
        return discoverAzureModels(provider.models, resource, run).catch((error: unknown) => {
          Effect.runSync(
            Effect.logWarning("Azure model discovery failed", {
              resource,
              error: error instanceof Error ? error.message : String(error),
            }),
          )
          return provider.models
        })
      },
    },
    auth: {
      provider: "azure",
      async loader(getAuth) {
        if ((await getAuth()).type !== "oauth") return {}

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            const headers = new Headers(input instanceof Request ? input.headers : undefined)
            new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
            headers.delete("api-key")
            headers.delete("x-api-key")
            headers.set("authorization", `Bearer ${await token(scopeForRequest(input))}`)
            headers.set("User-Agent", `opencode/${InstallationVersion}`)
            return request(input, { ...init, headers })
          },
        }
      },
      methods: [
        {
          type: "api",
          label: "API key",
          prompts,
        },
        {
          type: "oauth",
          label: "Microsoft Entra ID (Azure CLI)",
          prompts: oauthPrompts,
          async authorize(inputs) {
            return {
              url: "",
              instructions: "Sign in with `az login` before continuing.",
              method: "auto",
              callback: async () => {
                const resourceName =
                  inputs?.resourceName ??
                  (inputs?.resourceSelection === "__manual__" ? undefined : inputs?.resourceSelection) ??
                  process.env.AZURE_RESOURCE_NAME
                if (!resourceName) throw new Error("Azure Resource Name is required")

                await token(AZURE_COGNITIVE_SERVICES_SCOPE)
                return {
                  type: "success",
                  access: OAUTH_DUMMY_KEY,
                  refresh: OAUTH_DUMMY_KEY,
                  expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
                  accountId: resourceName,
                }
              },
            }
          },
        },
      ],
    },
  }
  if (!available && hooks.auth) hooks.auth.methods = hooks.auth.methods.filter((method) => method.type !== "oauth")
  return hooks
}

async function runAzure(args: string[]): Promise<unknown> {
  const result = await Process.run([which("az") ?? "az", ...args])
  return JSON.parse(result.stdout.toString())
}

async function discoverAzureModels(models: Provider["models"], resourceName: string, run: AzureCommand) {
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP
  const account = resourceGroup
    ? { name: resourceName, resourceGroup }
    : (
        await decodeAzureAccounts(
          await run(["cognitiveservices", "account", "list", "--output", "json", "--only-show-errors"]),
        )
      ).find((account) => account.name.toLowerCase() === resourceName.toLowerCase())
  if (!account) throw new Error(`Azure resource "${resourceName}" was not found in the active subscription`)

  const deployments = await decodeAzureDeployments(
    await run([
      "cognitiveservices",
      "account",
      "deployment",
      "list",
      "--name",
      account.name,
      "--resource-group",
      account.resourceGroup,
      "--output",
      "json",
      "--only-show-errors",
    ]),
  )
  const found = new Map<string, Provider["models"][string]>()
  deployments.forEach((deployment) => {
    if (deployment.properties.provisioningState !== "Succeeded") return
    const modelID = Object.keys(models).find(
      (modelID) => modelID.toLowerCase() === deployment.properties.model.name.toLowerCase(),
    )
    if (!modelID) return
    const id = found.has(modelID) ? deployment.name : modelID
    found.set(id, {
      ...models[modelID],
      id,
      name: id === modelID ? models[modelID].name : `${models[modelID].name} (${deployment.name})`,
      api: {
        ...models[modelID].api,
        id: deployment.name,
      },
    })
  })
  return Object.fromEntries(found)
}

function scopeForRequest(input: RequestInfo | URL) {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.hostname.endsWith(".services.ai.azure.com") && !url.pathname.startsWith("/models")) {
    return AZURE_FOUNDRY_SCOPE
  }
  return AZURE_COGNITIVE_SERVICES_SCOPE
}
