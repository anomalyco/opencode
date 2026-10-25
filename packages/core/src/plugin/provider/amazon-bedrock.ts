import { Effect } from "effect"
import path from "node:path"
import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
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

const isBedrock = (item: { readonly package: string }) =>
  item.package.startsWith("@opencode/ai/providers/amazon-bedrock")

export const AmazonBedrockPlugin = define({
  id: "opencode.provider.amazon.bedrock",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service
    const paths = [
      process.env.AWS_CONFIG_FILE ?? path.join(Global.Path.home, ".aws", "config"),
      process.env.AWS_SHARED_CREDENTIALS_FILE ?? path.join(Global.Path.home, ".aws", "credentials"),
    ]
    const files = yield* Effect.all(
      paths.map((file) => fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))),
    )
    yield* ctx.aisdk.sdk(
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
          const { fromNodeProviderChain } = yield* Effect.promise(() => import("@aws-sdk/credential-providers"))
          options.credentialProvider = fromNodeProviderChain(profile ? { profile } : {})
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
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.amazonBedrock) return
        if (evt.model.api.type === "aisdk" && evt.model.api.package === "@ai-sdk/amazon-bedrock/mantle") {
          evt.language = selectMantleModel(evt.sdk, evt.model.api.id)
          return
        }
        const region = typeof evt.options.region === "string" ? evt.options.region : process.env.AWS_REGION
        evt.language = evt.sdk.languageModel(resolveModelID(evt.model.api.id, region))
      }),
    )
      .filter(Boolean)
      .toSorted()
    yield* ctx.integration.transform((editor) => {
      // models.dev advertises AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and
      // AWS_REGION alongside the bearer token. Only the bearer token is a key;
      // the rest feed the SigV4 credential chain and must not become one.
      editor.method.update({
        integrationID: Provider.ID.amazonBedrock,
        method: { type: "env", names: ["AWS_BEARER_TOKEN_BEDROCK"] },
      })
      editor.method.update({
        integrationID: Provider.ID.amazonBedrock,
        method: { type: "key", label: "Bedrock API key" },
      })
      editor.method.update({
        integrationID: Provider.ID.amazonBedrock,
        method: {
          id: "aws-profile",
          type: "external",
          label: "AWS profile (SSO or named profile)",
          form: [
            {
              key: "profile",
              type: "string",
              title: "AWS profile",
              description: profiles.length
                ? `Found ${profiles.length} profile${profiles.length === 1 ? "" : "s"} in your AWS configuration.`
                : "No profiles found in your AWS configuration.",
              required: true,
              minLength: 1,
              pattern: "\\S",
              placeholder: "Profile name",
              custom: true,
              options: profiles.map((profile) => ({ value: profile, label: profile })),
            },
          ],
        },
      })
    })
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (!isBedrock(item.provider)) continue
        evt.update(item.provider.id, (provider) => {
          const settings = provider.settings ?? {}
          const chain = typeof settings.profile === "string" || CHAIN_ENV.some((name) => process.env[name])
          // SigV4 authenticates through the AWS default chain rather than a key
          // credential, so ambient AWS configuration is what makes Bedrock usable.
          if (chain && provider.activation === "auto") provider.activation = "enabled"
          // Same default the native package uses, made explicit here so catalog
          // `${AWS_REGION}` URLs resolve without any region configured.
          const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1"
          provider.settings = {
            ...settings,
            ...(typeof settings.region !== "string" ? { region } : {}),
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
