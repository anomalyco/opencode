import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Provider } from "../../provider.js"

// Ambient inputs the AWS default credential chain can turn into credentials
// without any key stored in opencode. Mirrors the presence checks the AWS CLI
// and SDK use before consulting shared config.
const CHAIN_ENV = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
]

const isBedrock = (item: { readonly package: string }) => {
  const name = Provider.packageName(item.package)
  return name.startsWith("@ai-sdk/amazon-bedrock") || name.startsWith("@opencode-ai/ai/providers/amazon-bedrock")
}

export const AmazonBedrockPlugin = define({
  id: "opencode.provider.amazon.bedrock",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      // models.dev advertises AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and
      // AWS_REGION alongside the bearer token. Only the bearer token is a key;
      // the rest feed the SigV4 credential chain and must not become one.
      editor.method.update({
        integrationID: Provider.ID.amazonBedrock,
        method: { type: "env", names: ["AWS_BEARER_TOKEN_BEDROCK"] },
      })
    })
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!isBedrock(item.provider)) continue
        evt.provider.update(item.provider.id, (provider) => {
          const settings = provider.settings ?? {}
          const chain = typeof settings.profile === "string" || CHAIN_ENV.some((name) => process.env[name])
          // SigV4 authenticates through the AWS default chain rather than a key
          // credential, so ambient AWS configuration is what makes Bedrock usable.
          if (chain && provider.activation === "auto") provider.activation = "enabled"
          const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION
          provider.settings = {
            ...settings,
            ...(typeof settings.region !== "string" && region ? { region } : {}),
            // Users configure Bedrock private/VPC endpoints as `endpoint`; move it
            // into the catalog base URL once.
            ...(typeof settings.baseURL !== "string" && typeof settings.endpoint === "string"
              ? { baseURL: settings.endpoint }
              : {}),
          }
          delete provider.settings.endpoint
        })
      }
    })
  }),
})
