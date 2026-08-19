import type { RouteDefaultsInput } from "../route/client.js"
import { Auth } from "../route/auth.js"
import { ProviderPackage } from "../provider-package.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import * as BedrockConverse from "../protocols/bedrock-converse.js"
import type { BedrockCredentials } from "../protocols/bedrock-converse.js"

export const id = ProviderID.make("amazon-bedrock")

export type Config = RouteDefaultsInput & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  readonly credentials?: BedrockCredentials
  /** AWS region. Defaults to `us-east-1` when neither this nor `credentials.region` is set. */
  readonly region?: string
  /** Override the computed `https://bedrock-runtime.<region>.amazonaws.com` URL. */
  readonly baseURL?: string
}

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly auth?: "bearer" | "sigv4"
  readonly baseURL?: string
  readonly credentials?: BedrockCredentials
  readonly region?: string
  readonly topP?: number
}
export const routes = [BedrockConverse.route]

const bedrockBaseURL = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`

const configuredRoute = (input: Config) => {
  const { apiKey, credentials, region, baseURL, ...rest } = input
  const resolvedRegion = region ?? credentials?.region ?? "us-east-1"
  return BedrockConverse.route.with({
    ...rest,
    provider: id,
    endpoint: { baseURL: baseURL ?? bedrockBaseURL(resolvedRegion) },
    auth: apiKey === undefined ? BedrockConverse.sigV4Auth(credentials) : Auth.bearer(apiKey),
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
export const model: ProviderPackage.Definition<Settings>["model"] = (input) => {
  if (!input.credential && input.settings.auth === "bearer" && input.settings.apiKey === undefined)
    throw new Error("Amazon Bedrock bearer auth requires apiKey")
  if (!input.credential && input.settings.auth === "sigv4" && input.settings.apiKey !== undefined)
    throw new Error("Amazon Bedrock SigV4 auth does not accept apiKey")
  return configure({
    ...ProviderPackage.routeDefaults(input.defaults),
    apiKey: input.credential
      ? ProviderPackage.bearerCredentialValue(input.credential)
      : input.settings.auth === "sigv4"
        ? undefined
        : input.settings.apiKey,
    baseURL: input.settings.baseURL,
    credentials: input.settings.credentials,
    generation: input.settings.topP === undefined ? undefined : { topP: input.settings.topP },
    region: input.settings.region,
  }).model(input.id)
}
