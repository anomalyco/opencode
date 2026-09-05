import type { RouteDefaultsInput } from "../route/client.js"
import type { ProviderPackage } from "../provider-package.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import * as BedrockConverse from "../protocols/bedrock-converse.js"
import type { BedrockCredentials } from "../protocols/bedrock-converse.js"
import { BedrockAuth } from "../protocols/utils/bedrock-auth.js"

export const id = ProviderID.make("amazon-bedrock")

export type Config = RouteDefaultsInput & {
  /** Bedrock API key. Falls back to `AWS_BEARER_TOKEN_BEDROCK`; bearer auth takes precedence over SigV4. */
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  /** Static SigV4 credentials. When omitted the AWS default credential chain resolves them per request. */
  readonly credentials?: BedrockCredentials
  /** Shared config profile for the default credential chain. */
  readonly profile?: string
  /** AWS region. Falls back to `credentials.region`, `AWS_REGION`, `AWS_DEFAULT_REGION`, then `us-east-1`. */
  readonly region?: string
  /** Override the computed `https://bedrock-runtime.<region>.amazonaws.com` URL. */
  readonly baseURL?: string
}

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly auth?: "bearer" | "sigv4"
  readonly baseURL?: string
  readonly credentials?: BedrockCredentials
  readonly profile?: string
  readonly region?: string
  readonly topP?: number
}
export const routes = [BedrockConverse.route]

const bedrockBaseURL = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`

const configuredRoute = (input: Config, mode?: BedrockAuth.ResolveAuthOptions["mode"]) => {
  const { apiKey, credentials, profile, region, baseURL, ...rest } = input
  const resolvedRegion = BedrockAuth.resolveRegion(input)
  return BedrockConverse.route.with({
    ...rest,
    provider: id,
    providerMetadataKey: "bedrock",
    endpoint: { baseURL: baseURL ?? bedrockBaseURL(resolvedRegion) },
    auth: BedrockAuth.resolveAuth({ apiKey, credentials, profile }, resolvedRegion, { mode }),
  })
}

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) => {
  if (settings.auth === "bearer" && settings.apiKey === undefined && process.env.AWS_BEARER_TOKEN_BEDROCK === undefined)
    throw new Error("Amazon Bedrock bearer auth requires apiKey")
  if (settings.auth === "sigv4" && settings.apiKey !== undefined)
    throw new Error("Amazon Bedrock SigV4 auth does not accept apiKey")
  return configuredRoute(
    {
      apiKey: settings.apiKey,
      baseURL: settings.baseURL,
      credentials: settings.credentials,
      generation: settings.topP === undefined ? undefined : { topP: settings.topP },
      headers: settings.headers === undefined ? undefined : { ...settings.headers },
      http: settings.body === undefined ? undefined : { body: { ...settings.body } },
      profile: settings.profile,
      region: settings.region,
    },
    settings.auth,
  ).model({ id: modelID })
}
