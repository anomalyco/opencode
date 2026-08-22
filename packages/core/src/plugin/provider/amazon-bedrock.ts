import { Effect } from "effect"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { define } from "@opencode-ai/plugin/effect/plugin"
import type { ProviderHooks } from "@opencode-ai/plugin/effect/provider"
import { Provider } from "../../provider.js"

type MantleSDK = {
  languageModel: (modelID: string) => LanguageModelV3
  chat: (modelID: string) => LanguageModelV3
  responses: (modelID: string) => LanguageModelV3
}

// Bedrock cross-region inference profiles require regional prefixes only for
// specific model/region combinations. Keep the mapping narrow and avoid
// double-prefixing model IDs that models.dev already marks as global/us/eu/etc.
function resolveModelID(modelID: string, region: string | undefined) {
  const crossRegionPrefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."]
  if (crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))) return modelID

  const resolvedRegion = region ?? "us-east-1"
  const regionPrefix = resolvedRegion.split("-")[0]
  if (regionPrefix === "us") {
    const requiresPrefix = ["nova-micro", "nova-lite", "nova-pro", "nova-premier", "nova-2", "claude", "deepseek"].some(
      (item) => modelID.includes(item),
    )
    if (requiresPrefix && !resolvedRegion.startsWith("us-gov")) return `${regionPrefix}.${modelID}`
    return modelID
  }
  if (regionPrefix === "eu") {
    const regionRequiresPrefix = [
      "eu-west-1",
      "eu-west-2",
      "eu-west-3",
      "eu-north-1",
      "eu-central-1",
      "eu-south-1",
      "eu-south-2",
    ].some((item) => resolvedRegion.includes(item))
    const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((item) =>
      modelID.includes(item),
    )
    return regionRequiresPrefix && modelRequiresPrefix ? `${regionPrefix}.${modelID}` : modelID
  }
  if (regionPrefix !== "ap") return modelID

  const australia = ["ap-southeast-2", "ap-southeast-4"].includes(resolvedRegion)
  if (australia && ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((item) => modelID.includes(item))) {
    return `au.${modelID}`
  }

  const prefix = resolvedRegion === "ap-northeast-1" ? "jp" : "apac"
  return ["claude", "nova-lite", "nova-micro", "nova-pro"].some((item) => modelID.includes(item))
    ? `${prefix}.${modelID}`
    : modelID
}

function selectMantleModel(sdk: MantleSDK, modelID: string) {
  if (modelID === "openai.gpt-oss-safeguard-20b" || modelID === "openai.gpt-oss-safeguard-120b")
    return sdk.chat(modelID)
  return sdk.responses(modelID)
}

type AWSCredentialProvider = () => Promise<{
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}>

const AWS_CREDENTIAL_REFRESH_INTERVAL = 5 * 60 * 1000
const awsCredentialChains = new Map<string, AWSCredentialProvider>()

const awsCredentialChain = Effect.fn("AmazonBedrock.awsCredentialChain")(function* (profile: string | undefined) {
  const key = profile ?? ""
  const cached = awsCredentialChains.get(key)
  if (cached !== undefined) return cached
  const { fromNodeProviderChain } = yield* Effect.promise(() => import("@aws-sdk/credential-providers"))
  const chain = fromNodeProviderChain(profile === undefined ? { ignoreCache: true } : { profile, ignoreCache: true })
  const state = { failed: false, resolvedAt: 0 }
  const provider = () => {
    return chain(
      state.failed || (state.resolvedAt > 0 && Date.now() - state.resolvedAt >= AWS_CREDENTIAL_REFRESH_INTERVAL)
        ? { forceRefresh: true }
        : undefined,
    ).then(
      (credentials) => {
        state.failed = false
        state.resolvedAt = Date.now()
        return credentials
      },
      (error) => {
        state.failed = true
        throw error
      },
    )
  }
  awsCredentialChains.set(key, provider)
  return provider
})

const resolveAWSCredentials = (profile: string | undefined, region: string) =>
  Effect.gen(function* () {
    const chain = yield* awsCredentialChain(profile)
    const credentials = yield* Effect.tryPromise(() => chain())
    return {
      region,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.as(Effect.logDebug(`Amazon Bedrock credential resolution failed: ${error}`), undefined),
    ),
  )

function resolveRegion(settings: Readonly<Record<string, unknown>>) {
  if (typeof settings.region === "string") return settings.region
  if (
    typeof settings.credentials === "object" &&
    settings.credentials !== null &&
    "region" in settings.credentials &&
    typeof settings.credentials.region === "string"
  )
    return settings.credentials.region
  return process.env.AWS_REGION ?? "us-east-1"
}

function isBedrockProvider(provider: Pick<Provider.Info, "id" | "package">) {
  return (
    provider.id === Provider.ID.amazonBedrock ||
    Provider.packageName(provider.package) === "@ai-sdk/amazon-bedrock" ||
    provider.package.startsWith("@opencode-ai/ai/providers/amazon-bedrock")
  )
}

const detectAvailability = Effect.fn("AmazonBedrock.detectAvailability")(function* (evt: ProviderHooks["available"]) {
  if (evt.available || !isBedrockProvider(evt.provider)) return
  const profile =
    typeof evt.provider.settings?.profile === "string" ? evt.provider.settings.profile : process.env.AWS_PROFILE
  evt.available = (yield* resolveAWSCredentials(profile, resolveRegion(evt.provider.settings ?? {}))) !== undefined
})

const prepareNativeModel = Effect.fn("AmazonBedrock.prepareNativeModel")(function* (
  evt: ProviderHooks["model.prepare"],
) {
  if (!evt.package.startsWith("@opencode-ai/ai/providers/amazon-bedrock")) return
  const region = resolveRegion(evt.settings)
  if (typeof evt.settings.baseURL === "string")
    evt.settings.baseURL = evt.settings.baseURL.replaceAll("${AWS_REGION}", region)
  if (evt.settings.credentials !== undefined) return

  const configured = typeof evt.model.settings?.profile === "string" ? evt.model.settings.profile : undefined
  if (configured === undefined && typeof evt.settings.apiKey === "string") return
  const credentials = yield* resolveAWSCredentials(configured ?? process.env.AWS_PROFILE, region)
  if (credentials === undefined) return
  delete evt.settings.accessToken
  delete evt.settings.apiKey
  delete evt.settings.authToken
  evt.settings.credentials = credentials
  evt.settings.region = region
})

export const AmazonBedrockPlugin = define({
  id: "opencode.provider.amazon.bedrock",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.method.update({
        integrationID: Provider.ID.amazonBedrock,
        method: {
          type: "env",
          names: ["AWS_BEARER_TOKEN_BEDROCK"],
        },
      })
    })
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!isBedrockProvider(item.provider)) continue
        evt.provider.update(item.provider.id, (provider) => {
          if (provider.activation === "auto" && typeof provider.settings?.profile === "string")
            provider.activation = "enabled"
          if (typeof provider.settings?.endpoint !== "string") return
          // The AI SDK expects a base URL, but users configure Bedrock private/VPC
          // endpoints as `endpoint`; move it into the catalog endpoint URL once.
          provider.settings.baseURL = provider.settings.endpoint
          delete provider.settings.endpoint
        })
      }
    })
    yield* ctx.provider.hook("available", detectAvailability)
    yield* ctx.provider.hook("model.prepare", prepareNativeModel)
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (!["@ai-sdk/amazon-bedrock", "@ai-sdk/amazon-bedrock/mantle"].includes(evt.package)) return
        const options = { ...evt.options }
        const profile = typeof options.profile === "string" ? options.profile : process.env.AWS_PROFILE
        const region = typeof options.region === "string" ? options.region : (process.env.AWS_REGION ?? "us-east-1")
        const bearerToken =
          process.env.AWS_BEARER_TOKEN_BEDROCK ??
          (typeof options.bearerToken === "string" ? options.bearerToken : undefined)
        if (bearerToken && !process.env.AWS_BEARER_TOKEN_BEDROCK) process.env.AWS_BEARER_TOKEN_BEDROCK = bearerToken
        options.region = region
        if (typeof options.endpoint === "string") options.baseURL = options.endpoint
        if (!bearerToken && options.credentialProvider === undefined) {
          // Do not gate SDK creation on explicit AWS env vars. The default chain
          // also handles ~/.aws/credentials, SSO, process creds, and instance roles.
          options.credentialProvider = yield* awsCredentialChain(profile)
        }

        if (evt.package === "@ai-sdk/amazon-bedrock/mantle") {
          const mod = yield* Effect.promise(() => import("@ai-sdk/amazon-bedrock/mantle"))
          evt.sdk = mod.createBedrockMantle(options)
          return
        }

        const mod = yield* Effect.promise(() => import("@ai-sdk/amazon-bedrock"))
        evt.sdk = mod.createAmazonBedrock(options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.amazonBedrock) return
        if (
          Provider.isAISDK(evt.model.package) &&
          Provider.packageName(evt.model.package) === "@ai-sdk/amazon-bedrock/mantle"
        ) {
          evt.language = selectMantleModel(evt.sdk, evt.model.modelID ?? evt.model.id)
          return
        }
        const region = typeof evt.options.region === "string" ? evt.options.region : process.env.AWS_REGION
        evt.language = evt.sdk.languageModel(resolveModelID(evt.model.modelID ?? evt.model.id, region))
      }),
    )
  }),
})
