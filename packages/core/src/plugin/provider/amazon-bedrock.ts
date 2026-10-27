import { Effect, Option, Schema, Semaphore, Stream } from "effect"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import path from "node:path"
import { BedrockAuth } from "@opencode/ai/protocols/utils/bedrock-auth"
import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

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

const FoundationModels = Schema.Struct({
  modelSummaries: Schema.Array(
    Schema.Struct({
      modelId: Schema.String,
      inferenceTypesSupported: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})
const InferenceProfiles = Schema.Struct({
  inferenceProfileSummaries: Schema.Array(Schema.Struct({ inferenceProfileId: Schema.String })),
})
const MantleModels = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })

export const AmazonBedrockPlugin = define({
  id: "opencode.provider.amazon.bedrock",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const loading = Semaphore.makeUnsafe(1)
    // Model IDs the account's region serves: Bedrock Runtime IDs and Mantle IDs are listed separately.
    const listed: { runtime?: ReadonlySet<string>; mantle?: ReadonlySet<string> } = {}
    const paths = [
      process.env.AWS_CONFIG_FILE ?? path.join(Global.Path.home, ".aws", "config"),
      process.env.AWS_SHARED_CREDENTIALS_FILE ?? path.join(Global.Path.home, ".aws", "credentials"),
    ]
    const files = yield* Effect.all(
      paths.map((file) => fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))),
    )
    // Discover names only. Resolving every profile here could run credential helpers or contact AWS.
    const profiles = Array.from(
      new Set(
        files.flatMap((content, index) =>
          Array.from((content ?? "").matchAll(/^\s*\[([^\]\r\n]+)\]/gm)).flatMap((match) => {
            const section = match[1].trim()
            // The credentials file uses bare names; the config file prefixes all but "default" with "profile ".
            if (index === 1 || section === "default") return [section]
            return section.startsWith("profile ") ? [section.slice(8).trim()] : []
          }),
        ),
      ),
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
    yield* ctx.model.transform((models) => {
      if (!listed.runtime || !listed.mantle) return
      // Narrowing here rather than in the provider catalog keeps every catalog model available as the base
      // of a model the user configures explicitly; those are applied after this transform.
      for (const model of models.list(Provider.ID.amazonBedrock)) {
        const available = model.package?.startsWith("@opencode/ai/providers/amazon-bedrock/mantle")
          ? listed.mantle
          : listed.runtime
        if (!available.has(model.modelID)) models.remove(Provider.ID.amazonBedrock, model.id)
      }
    })

    const list = Effect.fn("AmazonBedrockPlugin.list")(function* () {
      const settings = (yield* providers.get(Provider.ID.amazonBedrock))?.settings ?? {}
      // A custom endpoint may serve other models than the region does, so it keeps the catalog.
      if (typeof settings.region !== "string" || typeof settings.baseURL === "string") return undefined
      const region = settings.region
      const connection = yield* ctx.integration.connection.active(Provider.ID.amazonBedrock)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      if (credential?.type === "oauth") return undefined
      const profile = credential?.type === "external" ? credential.metadata?.profile : settings.profile
      // Without stored or ambient AWS configuration the default chain can only fail or probe instance metadata.
      if (!credential && typeof profile !== "string" && !CHAIN_ENV.some((name) => process.env[name])) return undefined
      const key = credential?.type === "key" ? credential.key : undefined
      const aws =
        key === undefined
          ? yield* BedrockAuth.defaultChain({ region, profile: typeof profile === "string" ? profile : undefined })
          : undefined
      const headers = (url: string) =>
        aws === undefined
          ? Effect.succeed<Record<string, string>>({ authorization: `Bearer ${key}` })
          : BedrockAuth.signRequest({
              url,
              method: "GET",
              headers: Headers.empty,
              credentials: aws,
              service: "bedrock",
              name: "Bedrock model list",
            })
      const get = <S extends Schema.Top>(url: string, schema: S) =>
        headers(url).pipe(
          Effect.flatMap((signed) =>
            http.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(signed))),
          ),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
        )
      const control = `https://bedrock.${region}.amazonaws.com`
      const [foundation, profiles, mantle] = yield* Effect.all(
        [
          get(`${control}/foundation-models`, FoundationModels),
          // One page holds every profile a region serves today; 1000 is the API maximum.
          get(`${control}/inference-profiles?maxResults=1000`, InferenceProfiles),
          get(`https://bedrock-mantle.${region}.api.aws/v1/models`, MantleModels),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.timeout("10 seconds"))
      return {
        // Base IDs without on-demand support only run through an inference profile, which is listed separately.
        runtime: new Set([
          ...foundation.modelSummaries
            .filter((model) => model.inferenceTypesSupported?.includes("ON_DEMAND"))
            .map((model) => model.modelId),
          ...profiles.inferenceProfileSummaries.map((profile) => profile.inferenceProfileId),
        ]),
        mantle: new Set(mantle.data.map((model) => model.id)),
      }
    })

    // A switch drops the previous account's list first, so a failed refresh falls back to the catalog.
    const refresh = (reset: boolean) =>
      loading.withPermit(
        Effect.gen(function* () {
          if (reset && listed.runtime) {
            Object.assign(listed, { runtime: undefined, mantle: undefined })
            yield* ctx.model.reload()
          }
          const result = yield* list().pipe(
            Effect.tapError((cause) => Effect.logWarning("failed to list Amazon Bedrock models", { cause })),
            Effect.option,
          )
          // Keep the last list through transient failures.
          if (Option.isNone(result)) return
          Object.assign(listed, { runtime: result.value?.runtime, mantle: result.value?.mantle })
          yield* ctx.model.reload()
        }),
      )
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("amazon-bedrock")),
      Stream.runForEach(() => refresh(true)),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Lists load in the background so startup never waits on AWS; the catalog serves until they arrive.
    yield* refresh(false).pipe(Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)
