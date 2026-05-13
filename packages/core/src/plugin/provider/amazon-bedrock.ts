import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

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

export const AmazonBedrockPlugin = PluginV2.define({
  id: PluginV2.ID.make("amazon-bedrock"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.amazonBedrock) return
        if (evt.provider.endpoint.type !== "aisdk") return
        if (typeof evt.provider.options.aisdk.provider.endpoint !== "string") return
        // The AI SDK expects a base URL, but users configure Bedrock private/VPC
        // endpoints as `endpoint`; move it into the catalog endpoint URL once.
        evt.provider.endpoint.url = evt.provider.options.aisdk.provider.endpoint
        delete evt.provider.options.aisdk.provider.endpoint
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/amazon-bedrock") return
        const options = { ...evt.options }
        const profile = typeof options.profile === "string" ? options.profile : process.env.AWS_PROFILE
        const region = typeof options.region === "string" ? options.region : (process.env.AWS_REGION ?? "us-east-1")
        const bearerToken =
          process.env.AWS_BEARER_TOKEN_BEDROCK ??
          (typeof options.bearerToken === "string" ? options.bearerToken : undefined)
        if (bearerToken && !process.env.AWS_BEARER_TOKEN_BEDROCK) process.env.AWS_BEARER_TOKEN_BEDROCK = bearerToken
        const containerCreds = Boolean(
          process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
        )

        options.region = region
        if (typeof options.endpoint === "string") options.baseURL = options.endpoint
        if (!bearerToken && options.credentialProvider === undefined) {
          // Do not gate SDK creation on explicit AWS env vars. The default chain
          // also handles ~/.aws/credentials, SSO, process creds, and instance roles.
          const { fromNodeProviderChain } = yield* Effect.promise(() => import("@aws-sdk/credential-providers"))
          options.credentialProvider = fromNodeProviderChain(profile ? { profile } : {})
        }

        const mod = yield* Effect.promise(() => import("@ai-sdk/amazon-bedrock"))
        evt.sdk = mod.createAmazonBedrock(options)
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.amazonBedrock) return
        const region = typeof evt.options.region === "string" ? evt.options.region : process.env.AWS_REGION
        evt.language = evt.sdk.languageModel(resolveModelID(evt.model.apiID, region))
      }),
    }
  }),
})
